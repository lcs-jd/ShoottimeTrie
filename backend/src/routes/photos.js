import path from 'path';
import fs from 'fs';
import { pipeline } from 'stream/promises';
import archiver from 'archiver';
import db from '../db.js';
import { watermarkQueue } from '../workers/queue.js';
import { broadcast } from './sse.js';

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
const WATERMARK_DIR = path.resolve(process.env.WATERMARK_DIR || path.join(DATA_DIR, '..', 'watermark'));
const WATERMARK_PATH = path.join(WATERMARK_DIR, 'logo.png');
fs.mkdirSync(WATERMARK_DIR, { recursive: true });

export default async function photosRoutes(fastify) {
  fastify.get('/api/sessions/:sessionId/photos', async (req, reply) => {
    const { sessionId } = req.params;
    const { status } = req.query;

    const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return reply.code(404).send({ error: 'session not found' });

    const query = status
      ? 'SELECT * FROM photos WHERE session_id = ? AND status = ? ORDER BY created_at ASC'
      : 'SELECT * FROM photos WHERE session_id = ? ORDER BY created_at ASC';

    const photos = status
      ? db.prepare(query).all(sessionId, status)
      : db.prepare(query).all(sessionId);

    return photos;
  });

  fastify.post('/api/photos/:id/keep', async (req, reply) => {
    const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(req.params.id);
    if (!photo) return reply.code(404).send({ error: 'not found' });

    db.prepare("UPDATE photos SET status = 'kept' WHERE id = ?").run(req.params.id);
    broadcast(photo.session_id, { type: 'photo_sorted', photoId: req.params.id, status: 'kept' });

    return { ok: true };
  });

  fastify.post('/api/photos/:id/discard', async (req, reply) => {
    const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(req.params.id);
    if (!photo) return reply.code(404).send({ error: 'not found' });

    db.prepare("UPDATE photos SET status = 'discarded' WHERE id = ?").run(req.params.id);
    broadcast(photo.session_id, { type: 'photo_sorted', photoId: req.params.id, status: 'discarded' });

    return { ok: true };
  });

  fastify.post('/api/sessions/:sessionId/keep-all', async (req, reply) => {
    const { sessionId } = req.params;
    const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return reply.code(404).send({ error: 'session not found' });

    const photos = db.prepare(
      "SELECT id FROM photos WHERE session_id = ? AND status != 'discarded'"
    ).all(sessionId);

    const stmt = db.prepare("UPDATE photos SET status = 'kept' WHERE id = ?");
    const updateMany = db.transaction((rows) => {
      for (const row of rows) stmt.run(row.id);
    });
    updateMany(photos);

    broadcast(sessionId, { type: 'keep_all', count: photos.length });
    return { updated: photos.length };
  });

  fastify.post('/api/sessions/:sessionId/process', async (req, reply) => {
    const { sessionId } = req.params;
    const photos = db.prepare(
      "SELECT * FROM photos WHERE session_id = ? AND status = 'kept'"
    ).all(sessionId);

    if (photos.length === 0) return reply.code(400).send({ error: 'no kept photos' });

    for (const photo of photos) {
      const absoluteOriginal = path.join(DATA_DIR, photo.original_path);
      await watermarkQueue.add('apply', { photoId: photo.id, originalPath: absoluteOriginal, sessionId });
    }

    db.prepare("UPDATE sessions SET status = 'processing' WHERE id = ?").run(sessionId);
    return { queued: photos.length };
  });

  // Relancer le filigranage sur toutes les photos kept + watermarked (ex: nouveau logo)
  fastify.post('/api/sessions/:sessionId/reprocess', async (req, reply) => {
    const { sessionId } = req.params;
    const photos = db.prepare(
      "SELECT * FROM photos WHERE session_id = ? AND status IN ('kept', 'watermarked')"
    ).all(sessionId);

    if (photos.length === 0) return reply.code(400).send({ error: 'no photos to reprocess' });

    // Remettre les watermarked en kept pour qu'ils soient retraités
    db.prepare(
      "UPDATE photos SET status = 'kept', watermarked_path = NULL WHERE session_id = ? AND status = 'watermarked'"
    ).run(sessionId);

    for (const photo of photos) {
      const absoluteOriginal = path.join(DATA_DIR, photo.original_path);
      await watermarkQueue.add('apply', { photoId: photo.id, originalPath: absoluteOriginal, sessionId });
    }

    db.prepare("UPDATE sessions SET status = 'processing' WHERE id = ?").run(sessionId);
    return { queued: photos.length };
  });

  fastify.get('/api/sessions/:sessionId/stats', async (req, reply) => {
    const { sessionId } = req.params;
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return reply.code(404).send({ error: 'not found' });

    const stats = db.prepare(`
      SELECT status, COUNT(*) as count
      FROM photos WHERE session_id = ?
      GROUP BY status
    `).all(sessionId);

    const counts = Object.fromEntries(stats.map(r => [r.status, r.count]));
    return { session, counts };
  });

  fastify.get('/api/sessions/:sessionId/download', async (req, reply) => {
    const { sessionId } = req.params;
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return reply.code(404).send({ error: 'not found' });

    const photos = db.prepare(
      "SELECT * FROM photos WHERE session_id = ? AND status = 'watermarked'"
    ).all(sessionId);

    if (photos.length === 0) {
      return reply.code(400).send({ error: 'Aucune photo filigranée disponible.' });
    }

    const safeName = session.name.replace(/[^a-zA-Z0-9_\-]/g, '_');
    reply.raw.setHeader('Content-Type', 'application/zip');
    reply.raw.setHeader('Content-Disposition', `attachment; filename="${safeName}_watermarked.zip"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(reply.raw);

    for (const photo of photos) {
      const absPath = path.join(DATA_DIR, photo.watermarked_path);
      if (fs.existsSync(absPath)) {
        archive.file(absPath, { name: photo.filename.replace(/\.[^.]+$/, '.jpg') });
      }
    }

    await archive.finalize();
  });

  fastify.get('/api/watermark', async (req, reply) => {
    if (!fs.existsSync(WATERMARK_PATH)) {
      return reply.code(404).send({ error: 'Aucun filigrane configuré.' });
    }
    reply.header('Content-Type', 'image/png');
    reply.header('Cache-Control', 'no-cache');
    return reply.send(fs.createReadStream(WATERMARK_PATH));
  });

  fastify.post('/api/watermark', async (req, reply) => {
    const data = await req.file({ limits: { fileSize: 5 * 1024 * 1024 } });
    if (!data) return reply.code(400).send({ error: 'Fichier manquant.' });

    const mime = data.mimetype;
    if (!mime.startsWith('image/')) {
      return reply.code(400).send({ error: 'Le fichier doit être une image.' });
    }

    await pipeline(data.file, fs.createWriteStream(WATERMARK_PATH));
    return { ok: true };
  });
}
