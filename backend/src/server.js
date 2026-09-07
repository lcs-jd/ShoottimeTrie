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
import emailRoutes from './routes/email.js';
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

// Garde-fou : en production, refuser de démarrer avec les secrets d'exemple.
if (process.env.NODE_ENV === 'production') {
  const weak = [];
  if (JWT_SECRET === 'changeme-jwt-secret-32chars-min!!' || JWT_SECRET.length < 32) weak.push('JWT_SECRET');
  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === 'changeme') weak.push('ADMIN_PASSWORD');
  if (weak.length) {
    console.error(`[sécurité] Refus de démarrer : ${weak.join(' et ')} ${weak.length > 1 ? 'ont' : 'a'} une valeur par défaut ou trop faible.`);
    process.exit(1);
  }
}

const fastify = Fastify({ logger: { level: 'info' } });

// CORS : `origin: '*'` avec `credentials: true` est refusé par les navigateurs et
// signale une configuration laxiste. En production on exige une origine explicite.
const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(o => o.trim()).filter(Boolean)
  : (process.env.NODE_ENV === 'production' ? false : true);

await fastify.register(cors, {
  origin: corsOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
});

await fastify.register(cookie);

await fastify.register(jwt, { secret: JWT_SECRET });

// En-têtes de sécurité sur toutes les réponses
fastify.addHook('onSend', async (req, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header('Cross-Origin-Resource-Policy', 'same-origin');
  reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  reply.removeHeader('X-Powered-By');
});

// Garde globale : /api/* (sauf /api/auth/*) et /media/* exigent une session valide.
// Les médias sont des photos privées : ils ne doivent jamais être servis en anonyme.
fastify.addHook('preHandler', async (req, reply) => {
  const isApi   = req.url.startsWith('/api/');
  const isMedia = req.url.startsWith('/media/');
  if (!isApi && !isMedia) return;
  if (isApi && req.url.startsWith('/api/auth/')) return;

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

// Servir les fichiers media. On expose uniquement les sous-dossiers d'images :
// servir DATA_DIR à la racine exposerait la base SQLite (shoottime.db et son WAL).
for (const dir of ['proxies', 'originals', 'watermarked']) {
  const root = path.join(DATA_DIR, dir);
  fs.mkdirSync(root, { recursive: true });
  await fastify.register(staticPlugin, {
    root,
    prefix: `/media/${dir}/`,
    decorateReply: false,
    index: false,
    dotfiles: 'deny',
    serveDotFiles: false,
  });
}

await fastify.register(authRoutes);
await fastify.register(uploadRoutes);
await fastify.register(photosRoutes);
await fastify.register(sseRoutes);
await fastify.register(settingsRoutes);
await fastify.register(emailRoutes);

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
