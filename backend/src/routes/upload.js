import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import { pipeline } from 'stream/promises';
import db from '../db.js';
import { thumbnailQueue } from '../workers/queue.js';
import { broadcast } from './sse.js';

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
const ORIGINALS_DIR = path.join(DATA_DIR, 'originals');

fs.mkdirSync(ORIGINALS_DIR, { recursive: true });

// Extensions et types acceptés. L'extension fournie par le client n'est jamais
// réutilisée telle quelle : un `.html` stocké puis servi depuis /media serait
// une XSS stockée.
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.heic', '.heif', '.cr2', '.cr3', '.nef', '.arw', '.dng']);

// Signatures binaires des formats acceptés (magic bytes)
function sniffImage(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return '.jpg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return '.png';
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return '.webp';
  // TIFF et la plupart des RAW (CR2, NEF, ARW, DNG) partagent l'en-tête TIFF
  if ((buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2A) ||
      (buf[0] === 0x4D && buf[1] === 0x4D && buf[2] === 0x00)) return '.tif';
  if (buf.slice(4, 8).toString('ascii') === 'ftyp') {
    const brand = buf.slice(8, 12).toString('ascii');
    if (brand.startsWith('hei') || brand.startsWith('mif') || brand.startsWith('cr3')) return '.heic';
  }
  return null;
}

// Nom d'affichage : on retire tout composant de chemin et les caractères de contrôle.
function sanitizeFilename(name) {
  const base = path.basename(String(name || 'photo')).replace(/[\x00-\x1f\x7f]/g, '');
  const clean = base.replace(/^\.+/, '').trim() || 'photo';
  return clean.slice(0, 200);
}

export default async function uploadRoutes(fastify) {
  fastify.get('/api/disk', async (req, reply) => {
    try {
      // statfs fonctionne avec n'importe quel chemin dans le volume, même sans être un point de montage
      const stat  = fs.statfsSync(DATA_DIR);
      const total = stat.blocks      * stat.bsize;
      const free  = stat.bfree       * stat.bsize;
      const used  = total - free;
      return { total, used, free };
    } catch {
      return reply.code(500).send({ error: 'Impossible de lire le disque.' });
    }
  });
  fastify.post('/api/sessions', async (req, reply) => {
    const { name } = req.body || {};
    if (typeof name !== 'string' || !name.trim()) return reply.code(400).send({ error: 'name required' });
    if (name.length > 200) return reply.code(400).send({ error: 'Nom trop long (200 caractères max).' });

    const id = randomUUID();
    db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(id, name.trim().slice(0, 200));

    return reply.code(201).send({ id, name: name.trim(), status: 'uploading' });
  });

  fastify.get('/api/sessions', async () => {
    return db.prepare('SELECT * FROM sessions ORDER BY created_at DESC').all();
  });

  fastify.get('/api/sessions/:id', async (req, reply) => {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.id);
    if (!session) return reply.code(404).send({ error: 'not found' });
    return session;
  });

  fastify.delete('/api/sessions/:id', async (req, reply) => {
    const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(req.params.id);
    if (!session) return reply.code(404).send({ error: 'not found' });

    const photos = db.prepare('SELECT id FROM photos WHERE session_id = ?').all(req.params.id);

    db.prepare('DELETE FROM sessions WHERE id = ?').run(req.params.id);

    // Suppression async en parallèle — pas bloquant pour la réponse HTTP
    // mais proprement awaité pour éviter les race conditions
    const sessionDir      = path.join(ORIGINALS_DIR, req.params.id);
    const PROXIES_DIR     = path.join(DATA_DIR, 'proxies');
    const WATERMARKED_DIR = path.join(DATA_DIR, 'watermarked');

    const deleteOps = [
      fs.promises.rm(sessionDir, { recursive: true, force: true }),
      ...photos.flatMap(photo => [
        fs.promises.rm(path.join(PROXIES_DIR,     `${photo.id}.webp`), { force: true }),
        fs.promises.rm(path.join(WATERMARKED_DIR, `${photo.id}.jpg`),  { force: true }),
      ]),
    ];
    // On attend toutes les suppressions avant de répondre
    await Promise.all(deleteOps).catch(err => {
      fastify.log.warn(`[delete session] nettoyage partiel : ${err.message}`);
    });

    return { ok: true };
  });

  fastify.post('/api/sessions/:id/upload', async (req, reply) => {
    const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(req.params.id);
    if (!session) return reply.code(404).send({ error: 'session not found' });

    const sessionDir = path.join(ORIGINALS_DIR, req.params.id);
    fs.mkdirSync(sessionDir, { recursive: true });

    // Charger les noms de fichiers déjà présents dans la session
    const existingFilenames = new Set(
      db.prepare('SELECT filename FROM photos WHERE session_id = ?')
        .all(req.params.id)
        .map(r => r.filename)
    );

    const parts = req.parts({ limits: { fileSize: 150 * 1024 * 1024 } });
    const uploaded = [];
    const duplicates = [];

    const rejected = [];

    for await (const part of parts) {
      if (part.type !== 'file') continue;

      const displayName = sanitizeFilename(part.filename);

      if (existingFilenames.has(displayName)) {
        // Vider le stream sans écrire
        part.file.resume();
        duplicates.push(displayName);
        continue;
      }

      // L'extension déclarée doit être plausible avant même de lire le contenu
      const claimedExt = path.extname(displayName).toLowerCase();
      if (claimedExt && !ALLOWED_EXT.has(claimedExt)) {
        part.file.resume();
        rejected.push({ filename: displayName, reason: 'format non supporté' });
        continue;
      }

      const photoId = randomUUID();
      // L'extension de stockage est déterminée par le contenu réel, jamais par le client.
      const tmpPath = path.join(sessionDir, `${photoId}.part`);

      await pipeline(part.file, fs.createWriteStream(tmpPath));

      if (part.file.truncated) {
        await fs.promises.rm(tmpPath, { force: true });
        rejected.push({ filename: displayName, reason: 'fichier trop volumineux' });
        continue;
      }

      // Validation du contenu réel : on relit l'en-tête du fichier écrit.
      const head = Buffer.alloc(32);
      const fh = await fs.promises.open(tmpPath, 'r');
      const { bytesRead } = await fh.read(head, 0, 32, 0);
      await fh.close();

      const realExt = sniffImage(head.subarray(0, bytesRead));
      if (!realExt) {
        await fs.promises.rm(tmpPath, { force: true });
        rejected.push({ filename: displayName, reason: "le fichier n'est pas une image" });
        continue;
      }

      const ext = ALLOWED_EXT.has(claimedExt) && claimedExt !== '.html' ? claimedExt : realExt;
      const safeFilename = `${photoId}${ext}`;
      const originalPath = path.join(sessionDir, safeFilename);
      const relPath = `originals/${req.params.id}/${safeFilename}`;
      await fs.promises.rename(tmpPath, originalPath);

      db.prepare(`
        INSERT INTO photos (id, session_id, filename, original_path)
        VALUES (?, ?, ?, ?)
      `).run(photoId, req.params.id, displayName, relPath);

      await thumbnailQueue.add('generate', {
        photoId,
        originalPath,
        sessionId: req.params.id,
      });

      existingFilenames.add(displayName);
      broadcast(req.params.id, { type: 'upload_done', photoId, filename: displayName });
      uploaded.push({ photoId, filename: displayName });
    }

    return { uploaded, duplicates, rejected };
  });
}
