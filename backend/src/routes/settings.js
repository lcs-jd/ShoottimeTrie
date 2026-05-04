import db from '../db.js';

const ALLOWED_KEYS = ['facebook_page_url'];

export default async function settingsRoutes(fastify) {
  fastify.get('/api/settings', async () => {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  });

  fastify.post('/api/settings', async (req, reply) => {
    const body = req.body || {};
    const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

    for (const [key, value] of Object.entries(body)) {
      if (!ALLOWED_KEYS.includes(key)) continue;
      if (typeof value !== 'string') continue;
      upsert.run(key, value.trim());
    }
    return { ok: true };
  });
}
