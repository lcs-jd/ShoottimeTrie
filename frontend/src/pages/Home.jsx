import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/api.js';

const STATUS = {
  uploading:  { label: 'Upload en cours', dot: 'var(--accent)',  pulse: true  },
  sorting:    { label: 'Tri en cours',    dot: '#3b82f6',        pulse: false },
  processing: { label: 'Filigranage',     dot: 'var(--accent)',  pulse: true  },
  done:       { label: 'Terminé',         dot: 'var(--success)', pulse: false },
};

function fmt(bytes) {
  if (bytes == null) return '…';
  if (bytes >= 1e12) return (bytes / 1e12).toFixed(1) + ' To';
  if (bytes >= 1e9)  return (bytes / 1e9).toFixed(1) + ' Go';
  if (bytes >= 1e6)  return (bytes / 1e6).toFixed(0) + ' Mo';
  return (bytes / 1e3).toFixed(0) + ' Ko';
}

function DiskBar({ free, total }) {
  if (!total) return null;
  const usedPct = Math.round(((total - free) / total) * 100);
  const color = usedPct >= 90 ? 'var(--danger)' : usedPct >= 75 ? 'var(--accent)' : 'var(--success)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
      <span style={{ fontSize: 14 }}>💾</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
          <span style={{ color: 'var(--muted)' }}>Stockage serveur</span>
          <span style={{ color, fontWeight: 600 }}>{fmt(free)} libres</span>
        </div>
        <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${usedPct}%`, background: color, borderRadius: 2, transition: 'width .4s ease' }} />
        </div>
        <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 4 }}>
          {fmt(total - free)} utilisés sur {fmt(total)} — {usedPct}%
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [sessions, setSessions] = useState([]);
  const [deleting, setDeleting] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [disk, setDisk] = useState(null);

  useEffect(() => {
    apiFetch('/api/sessions')
      .then(r => r.json())
      .then(d => { setSessions(d); setLoaded(true); })
      .catch(console.error);

    apiFetch('/api/disk')
      .then(r => r.json())
      .then(setDisk)
      .catch(console.error);
  }, []);

  async function deleteSession(id, name) {
    if (!confirm(`Supprimer l'évènement "${name}" et toutes ses photos ?`)) return;
    setDeleting(id);
    try {
      const res = await apiFetch(`/api/sessions/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setSessions(prev => prev.filter(s => s.id !== id));
    } catch { alert('Erreur lors de la suppression.'); }
    finally { setDeleting(null); }
  }

  return (
    <div className="page fadein">
      <div className="page-header">
        <div>
          <h1 className="page-title">Évènements</h1>
          <p className="page-subtitle">
            {loaded ? `${sessions.length} évènement${sessions.length !== 1 ? 's' : ''}` : '…'}
          </p>
        </div>
        <Link to="/upload">
          <button className="btn btn-primary">+ Nouvel évènement</button>
        </Link>
      </div>

      <DiskBar free={disk?.free} total={disk?.total} />

      <div style={{ height: 20 }} />

      {loaded && sessions.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">📂</div>
          <div className="empty-state-title">Aucun évènement</div>
          <div className="empty-state-desc">Créez un premier évènement pour commencer</div>
          <Link to="/upload">
            <button className="btn btn-primary">Créer un évènement</button>
          </Link>
        </div>
      )}

      <div className="session-list">
        {sessions.map(s => {
          const cfg = STATUS[s.status] || { label: s.status, dot: 'var(--dim)', pulse: false };
          return (
            <div key={s.id} className="session-item">
              <div className="session-item-info">
                <div className="session-item-icon">📷</div>
                <div style={{ minWidth: 0 }}>
                  <div className="session-item-name">{s.name}</div>
                  <div className="session-item-status">
                    <span className={`status-dot${cfg.pulse ? ' pulse' : ''}`} style={{ background: cfg.dot }} />
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{cfg.label}</span>
                  </div>
                </div>
              </div>

              <div className="session-item-actions">
                <Link to={`/sort/${s.id}`}>
                  <button className="btn btn-ghost btn-sm">Trier</button>
                </Link>
                <Link to={`/dashboard/${s.id}`}>
                  <button className="btn btn-primary btn-sm">Dashboard</button>
                </Link>
                <button
                  className="btn btn-danger-outline btn-icon btn-sm"
                  onClick={() => deleteSession(s.id, s.name)}
                  disabled={deleting === s.id}
                >
                  {deleting === s.id ? '…' : '✕'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
