import { timingSafeEqual, createHash } from 'crypto';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const COOKIE_NAME = 'st_token';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 jours en secondes

function hashPassword(pwd) {
  return createHash('sha256').update(pwd).digest();
}

export default async function authRoutes(fastify) {
  fastify.post('/api/auth/login', async (req, reply) => {
    const { password } = req.body || {};
    if (!password) return reply.code(400).send({ error: 'Mot de passe requis.' });

    const expected = hashPassword(ADMIN_PASSWORD);
    const given = hashPassword(String(password));

    let ok = false;
    try { ok = timingSafeEqual(expected, given); } catch { ok = false; }

    if (!ok) return reply.code(401).send({ error: 'Mot de passe incorrect.' });

    const token = fastify.jwt.sign({ role: 'admin' }, { expiresIn: '7d' });

    reply.setCookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: COOKIE_MAX_AGE,
      secure: process.env.NODE_ENV === 'production',
    });

    return { ok: true };
  });

  fastify.post('/api/auth/logout', async (req, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: '/' });
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
