import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/api.js';

export default function Home() {
  const [sessions, setSessions] = useState([]);
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    apiFetch('/api/sessions')
      .then(r => r.json())
      .then(setSessions)
      .catch(console.error);
  }, []);

  async function deleteSession(id, name) {
    if (!confirm(`Supprimer la session "${name}" et toutes ses photos ?`)) return;
    setDeleting(id);
    try {
      const res = await apiFetch(`/api/sessions/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setSessions(prev => prev.filter(s => s.id !== id));
    } catch {
      alert('Erreur lors de la suppression.');
    } finally {
      setDeleting(null);
    }
  }

  const statusLabel = {
    uploading: 'En cours',
    sorting: 'Tri',
    processing: 'Filigranage',
    done: 'Terminé',
  };

  return (
    <div className="page">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>Sessions</h1>
        <Link to="/upload"><button className="btn btn-primary">+ Nouvelle session</button></Link>
      </div>

      {sessions.length === 0 && (
        <p style={{ color: 'var(--text-muted)' }}>Aucune session. Créez-en une pour commencer.</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {sessions.map(s => (
          <div key={s.id} className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{s.name}</div>
              <span className={`badge badge-${s.status === 'uploading' ? 'pending' : 'kept'}`}>
                {statusLabel[s.status] || s.status}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Link to={`/sort/${s.id}`}>
                <button className="btn btn-ghost">Trier</button>
              </Link>
              <Link to={`/dashboard/${s.id}`}>
                <button className="btn btn-primary">Dashboard</button>
              </Link>
              <button
                className="btn btn-danger"
                onClick={() => deleteSession(s.id, s.name)}
                disabled={deleting === s.id}
                style={{ padding: '10px 14px' }}
              >
                {deleting === s.id ? '...' : '🗑'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
