import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import archiver from 'archiver';
import db from '../db.js';
import { watermarkQueue, facebookQueue } from '../workers/queue.js';
import { broadcast } from './sse.js';
import { extractTakenAt } from '../utils/exif.js';

const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');

export default async function photosRoutes(fastify) {
  fastify.get('/api/sessions/:sessionId/photos', async (req, reply) => {
    const { sessionId } = req.params;
    const { status } = req.query;

    const session = db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return reply.code(404).send({ error: 'session not found' });

    // sort: 'filename' (défaut), 'taken_at', 'date', 'status'
    // order: 'asc' (défaut) ou 'desc'
    const sortParam  = req.query.sort  || 'filename';
    const orderParam = (req.query.order || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';

    const SORT_COL = {
      filename: `filename ${orderParam}`,
      taken_at: `COALESCE(taken_at, 9999999999) ${orderParam}, filename ${orderParam}`,
      date:     `created_at ${orderParam}`,
      status:   `CASE status WHEN 'pending' THEN 0 WHEN 'kept' THEN 1 WHEN 'discarded' THEN 2 WHEN 'watermarked' THEN 3 WHEN 'published' THEN 4 ELSE 5 END ${orderParam}, filename ASC`,
    };
    const orderClause = SORT_COL[sortParam] ?? SORT_COL.filename;

    const query = status
      ? `SELECT * FROM photos WHERE session_id = ? AND status = ? ORDER BY ${orderClause}`
      : `SELECT * FROM photos WHERE session_id = ? ORDER BY ${orderClause}`;

    const photos = status
      ? db.prepare(query).all(sessionId, status)
      : db.prepare(query).all(sessionId);

    return photos;
  });

  // Backfill taken_at pour les photos existantes sans date EXIF
  fastify.post('/api/sessions/:sessionId/backfill-exif', async (req, reply) => {
    const { sessionId } = req.params;
    const photos = db.prepare(
      'SELECT id, original_path FROM photos WHERE session_id = ? AND taken_at IS NULL'
    ).all(sessionId);

    let updated = 0;
    for (const photo of photos) {
      const absPath = path.join(DATA_DIR, photo.original_path);
      if (!fs.existsSync(absPath)) continue;
      const takenAt = await extractTakenAt(absPath);
      if (takenAt) {
        db.prepare('UPDATE photos SET taken_at = ? WHERE id = ?').run(takenAt, photo.id);
        updated++;
      }
    }
    return { total: photos.length, updated };
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
      "SELECT * FROM photos WHERE session_id = ? AND status IN ('watermarked', 'published', 'facebook_error')"
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

  // Liste les albums de la Page Facebook (pour que l'utilisateur en choisisse un)
  fastify.get('/api/facebook-albums', async (req, reply) => {
    const PAGE_ID = process.env.FACEBOOK_PAGE_ID;
    const ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    if (!PAGE_ID || !ACCESS_TOKEN) {
      return reply.code(503).send({ error: 'Publication Facebook non configurée.' });
    }

    const url = new URL(`https://graph.facebook.com/v25.0/${PAGE_ID}/albums`);
    url.searchParams.set('access_token', ACCESS_TOKEN);
    url.searchParams.set('fields', 'id,name,count,created_time');
    url.searchParams.set('limit', '50');

    const res = await fetch(url.toString());
    const data = await res.json();
    if (!res.ok || data.error) {
      return reply.code(502).send({ error: data.error?.message || 'Erreur récupération albums Facebook' });
    }

    // Exclure les albums système (Photos de profil, Photos de couverture…)
    const SYSTEM_ALBUMS = ['Photos de profil', 'Profile Pictures', 'Cover Photos', 'Photos de couverture', 'Timeline Photos', 'Videos'];
    const albums = (data.data || []).filter(a => !SYSTEM_ALBUMS.includes(a.name));
    return { albums };
  });

  // Publier les photos filigranées dans un album Facebook existant
  fastify.post('/api/sessions/:sessionId/publish-facebook', async (req, reply) => {
    const { sessionId } = req.params;
    const { albumId, albumName } = req.body || {};

    if (!process.env.FACEBOOK_PAGE_ID || !process.env.FACEBOOK_PAGE_ACCESS_TOKEN) {
      return reply.code(503).send({ error: 'Publication Facebook non configurée (variables d\'environnement manquantes).' });
    }
    if (!albumId) {
      return reply.code(400).send({ error: 'albumId requis — choisissez un album existant.' });
    }

    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session) return reply.code(404).send({ error: 'session not found' });

    const photos = db.prepare(
      "SELECT * FROM photos WHERE session_id = ? AND status = 'watermarked'"
    ).all(sessionId);

    if (photos.length === 0) {
      return reply.code(400).send({ error: 'Aucune photo filigranée à publier.' });
    }

    db.prepare('INSERT INTO facebook_albums (id, session_id, album_id, album_name) VALUES (?, ?, ?, ?)')
      .run(randomUUID(), sessionId, albumId, albumName || albumId);

    for (let i = 0; i < photos.length; i++) {
      await facebookQueue.add('upload', {
        photoId: photos[i].id,
        watermarkedPath: photos[i].watermarked_path,
        albumId,
        sessionId,
        index: i,
        total: photos.length,
      });
    }

    db.prepare("UPDATE sessions SET status = 'publishing' WHERE id = ?").run(sessionId);
    return { queued: photos.length, albumId };
  });

  // Statut de publication Facebook pour une session
  fastify.get('/api/sessions/:sessionId/facebook-status', async (req, reply) => {
    const { sessionId } = req.params;
    const session = db.prepare('SELECT status FROM sessions WHERE id = ?').get(sessionId);
    const album = db.prepare(
      'SELECT * FROM facebook_albums WHERE session_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(sessionId);

    const counts = db.prepare(`
      SELECT status, COUNT(*) as count FROM photos
      WHERE session_id = ? AND status IN ('published', 'facebook_error', 'watermarked')
      GROUP BY status
    `).all(sessionId);

    const byStatus = Object.fromEntries(counts.map(r => [r.status, r.count]));
    const published = byStatus.published || 0;
    const errors    = byStatus.facebook_error || 0;
    const remaining = byStatus.watermarked || 0;

    // Détail photo par photo pour l'affichage post-publication
    const photoDetails = db.prepare(`
      SELECT id, filename, status, facebook_photo_id, proxy_path
      FROM photos
      WHERE session_id = ? AND status IN ('published', 'facebook_error')
      ORDER BY created_at ASC
    `).all(sessionId);

    const isPublishing = session?.status === 'publishing' && remaining > 0;
    const total = published + errors + remaining;

    return {
      album: album || null,
      published,
      errors,
      remaining,
      total: isPublishing ? total : published + errors,
      isPublishing,
      photos: photoDetails,
    };
  });

}
