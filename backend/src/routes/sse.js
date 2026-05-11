const clients = new Map();

export function broadcast(sessionId, data) {
  const sessionClients = clients.get(sessionId);
  if (!sessionClients) return;

  const payload = `data: ${JSON.stringify(data)}\n\n`;
  const dead = [];

  for (const res of sessionClients) {
    try {
      res.raw.write(payload);
    } catch {
      dead.push(res);
    }
  }

  // Nettoyer les clients qui n'ont pas pu recevoir le message
  for (const res of dead) {
    sessionClients.delete(res);
  }
  if (sessionClients.size === 0) clients.delete(sessionId);
}

// Nettoyage périodique des sessions vides (toutes les 5 min)
setInterval(() => {
  for (const [sessionId, set] of clients.entries()) {
    if (set.size === 0) clients.delete(sessionId);
  }
}, 5 * 60 * 1000);

export default async function sseRoutes(fastify) {
  fastify.get('/api/sessions/:sessionId/events', (req, reply) => {
    const { sessionId } = req.params;

    reply.raw.setHeader('Content-Type',  'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection',    'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no');
    reply.raw.flushHeaders();

    reply.raw.write(': connected\n\n');

    if (!clients.has(sessionId)) clients.set(sessionId, new Set());
    clients.get(sessionId).add(reply);

    const keepAlive = setInterval(() => {
      try {
        reply.raw.write(': ping\n\n');
      } catch {
        clearInterval(keepAlive);
      }
    }, 20000);

    req.raw.on('close', () => {
      clearInterval(keepAlive);
      const set = clients.get(sessionId);
      if (set) {
        set.delete(reply);
        if (set.size === 0) clients.delete(sessionId);
      }
    });
  });
}
