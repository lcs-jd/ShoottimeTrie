import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import staticPlugin from '@fastify/static';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import path from 'path';
import { fileURLToPath } from 'url';

import uploadRoutes from './routes/upload.js';
import photosRoutes from './routes/photos.js';
import sseRoutes from './routes/sse.js';
import authRoutes from './routes/auth.js';
import settingsRoutes from './routes/settings.js';
import { extractTakenAt } from './utils/exif.js';
import { broadcast } from './routes/sse.js';
import db from './db.js';
import fs from 'fs';

// Démarrer les workers (import déclenche leur instanciation)
import { thumbnailWorker } from './workers/thumbnail.js';
import { watermarkWorker } from './workers/watermark.js';
import { facebookWorker  } from './workers/facebook.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const PORT = parseInt(process.env.PORT || '3000', 10);

const JWT_SECRET = process.env.JWT_SECRET || 'changeme-jwt-secret-32chars-min!!';
const COOKIE_NAME = 'st_token';

const fastify = Fastify({ logger: { level: 'info' } });

await fastify.register(cors, {
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
});

await fastify.register(cookie);

await fastify.register(jwt, { secret: JWT_SECRET });

// Garde globale : toutes les routes /api/* sauf /api/auth/*
fastify.addHook('preHandler', async (req, reply) => {
  if (!req.url.startsWith('/api/')) return;
  if (req.url.startsWith('/api/auth/')) return;

  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return reply.code(401).send({ error: 'Non authentifié.' });
  try {
    fastify.jwt.verify(token);
  } catch {
    return reply.code(401).send({ error: 'Session expirée.' });
  }
});

await fastify.register(multipart, {
  limits: { fileSize: 150 * 1024 * 1024 },
});

// Servir les fichiers media (proxies, originals, watermarked)
await fastify.register(staticPlugin, {
  root: DATA_DIR,
  prefix: '/media/',
  decorateReply: false,
});

await fastify.register(authRoutes);
await fastify.register(uploadRoutes);
await fastify.register(photosRoutes);
await fastify.register(sseRoutes);
await fastify.register(settingsRoutes);

fastify.get('/health', async () => ({ ok: true }));

try {
  await fastify.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`Server running on port ${PORT}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}

// Backfill taken_at pour toutes les photos existantes sans date EXIF (tâche de fond)
setImmediate(async () => {
  const photos = db.prepare(
    'SELECT id, original_path FROM photos WHERE taken_at IS NULL AND proxy_path IS NOT NULL'
  ).all();
  if (!photos.length) return;

  console.log(`[backfill-exif] ${photos.length} photo(s) sans date EXIF…`);
  let updated = 0;
  const sessionsUpdated = new Set();

  for (const photo of photos) {
    const absPath = path.join(DATA_DIR, photo.original_path);
    if (!fs.existsSync(absPath)) continue;
    const takenAt = await extractTakenAt(absPath);
    if (takenAt) {
      db.prepare('UPDATE photos SET taken_at = ? WHERE id = ?').run(takenAt, photo.id);
      updated++;
      // Récupérer la session pour broadcaster la mise à jour
      const row = db.prepare('SELECT session_id FROM photos WHERE id = ?').get(photo.id);
      if (row) sessionsUpdated.add(row.session_id);
    }
  }

  // Notifier les sessions concernées pour que le frontend recharge
  for (const sessionId of sessionsUpdated) {
    broadcast(sessionId, { type: 'exif_ready' });
  }
  console.log(`[backfill-exif] ${updated}/${photos.length} photos mises à jour.`);
});

// Graceful shutdown : attendre la fin des jobs en cours avant de quitter
async function shutdown(signal) {
  fastify.log.info(`[shutdown] signal ${signal} reçu, arrêt propre…`);
  await fastify.close();
  await Promise.all([
    thumbnailWorker.close(),
    watermarkWorker.close(),
    facebookWorker.close(),
  ]);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
