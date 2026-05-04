import { useState } from 'react';

const STATUS = {
  pending:     { label: 'À trier',   color: 'var(--muted)',   border: 'rgba(255,255,255,0.08)' },
  kept:        { label: 'Gardée',    color: 'var(--success)', border: 'rgba(34,197,94,0.45)'   },
  discarded:   { label: 'Rejetée',   color: 'var(--danger)',  border: 'rgba(239,68,68,0.35)'   },
  watermarked: { label: 'Filigrané', color: 'var(--accent)',  border: 'rgba(245,158,11,0.45)'  },
};

export default function PhotoCard({ photo, onKeep, onDiscard }) {
  const [loading, setLoading] = useState(false);
  const proxyUrl = photo.proxy_path ? `/media/${photo.proxy_path}` : null;
  const isKept        = photo.status === 'kept';
  const isDiscarded   = photo.status === 'discarded';
  const isWatermarked = photo.status === 'watermarked';
  const s = STATUS[photo.status] || STATUS.pending;

  async function handle(action) {
    if (loading) return;
    setLoading(true);
    try { await action(); } finally { setLoading(false); }
  }

  return (
    <div className={`photo-card ${photo.status}`}>
      {proxyUrl ? (
        <img src={proxyUrl} alt={photo.filename} loading="lazy" />
      ) : (
        <div className="photo-card-placeholder">
          <div className="spinner" />
          <span style={{ fontSize: 11 }}>Génération…</span>
        </div>
      )}

      <div className="photo-badge" style={{ color: s.color, border: `1px solid ${s.border}` }}>
        {s.label}
      </div>

      {!isWatermarked && (
        <div className="photo-actions">
          <button
            className={`photo-btn photo-btn-keep${isKept ? ' active' : ''}`}
            disabled={loading || isKept}
            onClick={() => handle(onKeep)}
          >
            {isKept ? '✓ Gardée' : '✓ Garder'}
          </button>
          <button
            className={`photo-btn photo-btn-discard${isDiscarded ? ' active' : ''}`}
            disabled={loading || isDiscarded}
            onClick={() => handle(onDiscard)}
          >
            {isDiscarded ? '✕ Rejetée' : '✕ Rejeter'}
          </button>
        </div>
      )}
    </div>
  );
}
