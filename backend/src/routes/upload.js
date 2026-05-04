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
    if (!name?.trim()) return reply.code(400).send({ error: 'name required' });

    const id = randomUUID();
    db.prepare('INSERT INTO sessions (id, name) VALUES (?, ?)').run(id, name.trim());

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

    // Supprimer le dossier originals de la session
    const sessionDir = path.join(ORIGINALS_DIR, req.params.id);
    fs.rm(sessionDir, { recursive: true, force: true }, () => {});

    // Supprimer les proxies et fichiers filigranés de chaque photo
    const PROXIES_DIR = path.join(DATA_DIR, 'proxies');
    const WATERMARKED_DIR = path.join(DATA_DIR, 'watermarked');
    for (const photo of photos) {
      fs.rm(path.join(PROXIES_DIR, `${photo.id}.webp`), { force: true }, () => {});
      fs.rm(path.join(WATERMARKED_DIR, `${photo.id}.jpg`), { force: true }, () => {});
    }

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

    for await (const part of parts) {
      if (part.type !== 'file') continue;

      if (existingFilenames.has(part.filename)) {
        // Vider le stream sans écrire
        part.file.resume();
        duplicates.push(part.filename);
        continue;
      }

      const photoId = randomUUID();
      const ext = path.extname(part.filename) || '.jpg';
      const safeFilename = `${photoId}${ext}`;
      const originalPath = path.join(sessionDir, safeFilename);
      const relPath = `originals/${req.params.id}/${safeFilename}`;

      await pipeline(part.file, fs.createWriteStream(originalPath));

      db.prepare(`
        INSERT INTO photos (id, session_id, filename, original_path)
        VALUES (?, ?, ?, ?)
      `).run(photoId, req.params.id, part.filename, relPath);

      await thumbnailQueue.add('generate', {
        photoId,
        originalPath,
        sessionId: req.params.id,
      });

      existingFilenames.add(part.filename);
      broadcast(req.params.id, { type: 'upload_done', photoId, filename: part.filename });
      uploaded.push({ photoId, filename: part.filename });
    }

    return { uploaded, duplicates };
  });
}
