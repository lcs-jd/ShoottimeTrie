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

// Démarrer les workers (import déclenche leur instanciation)
import './workers/thumbnail.js';
import './workers/watermark.js';
import './workers/facebook.js';

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
