import { useEffect, useRef, useState } from 'react';

export function useSSE(sessionId, onMessage) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const [connected, setConnected] = useState(true);

  useEffect(() => {
    if (!sessionId) return;

    let es;
    let retryTimer;
    let active = true;

    function connect() {
      es = new EventSource(`/api/sessions/${sessionId}/events`, { withCredentials: true });

      es.onopen = () => {
        setConnected(true);
      };

      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          onMessageRef.current(data);
        } catch {
          // commentaire SSE (ping), ignorer
        }
      };

      es.onerror = () => {
        es.close();
        setConnected(false);
        if (active) {
          retryTimer = setTimeout(connect, 3000);
        }
      };
    }

    connect();

    return () => {
      active = false;
      clearTimeout(retryTimer);
      es?.close();
    };
  }, [sessionId]);

  return { connected };
}
