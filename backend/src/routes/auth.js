import { timingSafeEqual, createHash } from 'crypto';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const COOKIE_NAME = 'st_token';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 jours en secondes

// Limitation du brute-force : l'app n'a qu'un seul mot de passe, il faut donc
// rendre l'essai exhaustif impraticable. Verrou progressif par IP.
const MAX_ATTEMPTS  = 5;
const WINDOW_MS     = 15 * 60 * 1000;
const attempts      = new Map(); // ip -> { count, firstAt, lockedUntil }

function clientIp(req) {
  // On est derrière Traefik + nginx : X-Forwarded-For contient la chaîne des proxies,
  // la première adresse est celle du client.
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0].trim();
  return req.ip;
}

function checkRateLimit(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec) return { allowed: true };
  if (rec.lockedUntil && rec.lockedUntil > now) {
    return { allowed: false, retryAfter: Math.ceil((rec.lockedUntil - now) / 1000) };
  }
  if (now - rec.firstAt > WINDOW_MS) {
    attempts.delete(ip);
    return { allowed: true };
  }
  return { allowed: true };
}

function registerFailure(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now - rec.firstAt > WINDOW_MS) {
    attempts.set(ip, { count: 1, firstAt: now, lockedUntil: 0 });
    return;
  }
  rec.count++;
  if (rec.count >= MAX_ATTEMPTS) {
    // Verrou exponentiel : 1 min, 2 min, 4 min… plafonné à 1 h
    const factor = Math.min(2 ** (rec.count - MAX_ATTEMPTS), 60);
    rec.lockedUntil = now + factor * 60 * 1000;
  }
}

// Purge périodique pour éviter la croissance mémoire
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of attempts) {
    if (now - rec.firstAt > WINDOW_MS && (!rec.lockedUntil || rec.lockedUntil < now)) {
      attempts.delete(ip);
    }
  }
}, 10 * 60 * 1000).unref();

function hashPassword(pwd) {
  return createHash('sha256').update(pwd).digest();
}

export default async function authRoutes(fastify) {
  fastify.post('/api/auth/login', async (req, reply) => {
    const ip = clientIp(req);
    const limit = checkRateLimit(ip);
    if (!limit.allowed) {
      reply.header('Retry-After', limit.retryAfter);
      return reply.code(429).send({
        error: `Trop de tentatives. Réessaie dans ${Math.ceil(limit.retryAfter / 60)} minute(s).`,
      });
    }

    const { password } = req.body || {};
    if (!password) return reply.code(400).send({ error: 'Mot de passe requis.' });
    if (typeof password !== 'string' || password.length > 512) {
      return reply.code(400).send({ error: 'Mot de passe invalide.' });
    }

    const expected = hashPassword(ADMIN_PASSWORD);
    const given = hashPassword(String(password));

    let ok = false;
    try { ok = timingSafeEqual(expected, given); } catch { ok = false; }

    if (!ok) {
      registerFailure(ip);
      req.log.warn({ ip }, 'tentative de connexion échouée');
      return reply.code(401).send({ error: 'Mot de passe incorrect.' });
    }

    attempts.delete(ip); // connexion réussie : on repart de zéro

    const token = fastify.jwt.sign({ role: 'admin' }, { expiresIn: '7d' });

    reply.setCookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      maxAge: COOKIE_MAX_AGE,
      secure: process.env.NODE_ENV === 'production',
    });

    return { ok: true };
  });

  fastify.post('/api/auth/logout', async (req, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: '/', sameSite: 'strict', secure: process.env.NODE_ENV === 'production', httpOnly: true });
    return { ok: true };
  });

  fastify.get('/api/auth/me', async (req, reply) => {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) return reply.code(401).send({ authenticated: false });
    try {
      fastify.jwt.verify(token);
      return { authenticated: true };
    } catch {
      return reply.code(401).send({ authenticated: false });
    }
  });
}
