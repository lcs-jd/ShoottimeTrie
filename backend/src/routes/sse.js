const clients = new Map();

export function broadcast(sessionId, data) {
  const sessionClients = clients.get(sessionId);
  if (!sessionClients) return;

  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of sessionClients) {
    try {
      res.raw.write(payload);
    } catch {
      // client déconnecté, sera nettoyé à la fermeture
    }
  }
}

export default async function sseRoutes(fastify) {
  fastify.get('/api/sessions/:sessionId/events', (req, reply) => {
    const { sessionId } = req.params;

    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
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
