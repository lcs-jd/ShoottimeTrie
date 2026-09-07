import { useState } from 'react';

const STATUS = {
  pending:        { label: 'À trier',          color: 'var(--muted)',   border: 'rgba(255,255,255,0.08)' },
  kept:           { label: 'Gardée',           color: 'var(--success)', border: 'rgba(34,197,94,0.45)'   },
  discarded:      { label: 'Rejetée',          color: 'var(--danger)',  border: 'rgba(239,68,68,0.35)'   },
  watermarked:    { label: 'Filigrané',        color: 'var(--accent)',  border: 'rgba(245,158,11,0.45)'  },
  published:      { label: 'Publié ↗',         color: '#1877f2',        border: 'rgba(24,119,242,0.45)'  },
  facebook_error: { label: 'Erreur FB',        color: 'var(--danger)',  border: 'rgba(239,68,68,0.35)'   },
  proxy_error:    { label: 'Erreur miniature', color: 'var(--danger)',  border: 'rgba(239,68,68,0.35)'   },
};

function formatTakenAt(ts) {
  if (!ts) return null;
  const d = new Date(ts * 1000);
  const day  = String(d.getDate()).padStart(2, '0');
  const mon  = String(d.getMonth() + 1).padStart(2, '0');
  const yr   = d.getFullYear();
  const h    = String(d.getHours()).padStart(2, '0');
  const m    = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${mon}/${yr} ${h}:${m}`;
}

export default function PhotoCard({ photo, onKeep, onDiscard, onExpand, selectMode = false, selected = false, onToggleSelect }) {
  const [loading, setLoading] = useState(false);
  const proxyUrl    = photo.proxy_path ? `/media/${photo.proxy_path}` : null;
  const isKept      = photo.status === 'kept';
  const isDiscarded = photo.status === 'discarded';
  const isFinal     = photo.status === 'watermarked' || photo.status === 'published' || photo.status === 'facebook_error';
  const s           = STATUS[photo.status] || STATUS.pending;
  const dateLabel   = formatTakenAt(photo.taken_at);

  async function handle(action) {
    if (loading) return;
    setLoading(true);
    try { await action(); } finally { setLoading(false); }
  }

  return (
    <div
      className={`photo-card ${photo.status}`}
      style={selected ? { outline: '2px solid var(--accent)', outlineOffset: 2 } : undefined}
    >
      {/* Image */}
      <div
        className="photo-card-img-wrap"
        onClick={selectMode ? onToggleSelect : (proxyUrl ? onExpand : undefined)}
        title={selectMode ? (selected ? 'Retirer de la sélection' : 'Ajouter à la sélection') : (proxyUrl ? 'Agrandir' : undefined)}
        style={{ cursor: selectMode ? 'pointer' : (proxyUrl ? 'zoom-in' : 'default'), position: 'relative' }}
      >
        {selectMode && (
          <div style={{
            position: 'absolute', top: 8, left: 8, zIndex: 3,
            width: 24, height: 24, borderRadius: 6,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 700, pointerEvents: 'none',
            background: selected ? 'var(--accent)' : 'rgba(0,0,0,0.55)',
            color: selected ? '#000' : 'rgba(255,255,255,0.75)',
            border: `1px solid ${selected ? 'var(--accent)' : 'rgba(255,255,255,0.35)'}`,
          }}>{selected ? '✓' : ''}</div>
        )}
        {proxyUrl ? (
          <img src={proxyUrl} alt={photo.filename} loading="lazy" />
        ) : photo.status === 'proxy_error' ? (
          <div className="photo-card-placeholder">
            <span style={{ fontSize: 18 }}>⚠</span>
            <span style={{ fontSize: 11, color: 'var(--danger)' }}>Erreur miniature</span>
          </div>
        ) : (
          <div className="photo-card-placeholder">
            <div className="spinner" />
            <span style={{ fontSize: 11 }}>Génération…</span>
          </div>
        )}
        {proxyUrl && !selectMode && <div className="photo-expand-hint">⤢</div>}
      </div>

      {/* Badge statut */}
      <div className="photo-badge" style={{ color: s.color, border: `1px solid ${s.border}` }}>
        {s.label}
      </div>

      {/* Nom + date */}
      <div className="photo-info">
        <span className="photo-info-name">{photo.filename}</span>
        {dateLabel && <span className="photo-info-date">{dateLabel}</span>}
      </div>

      {/* Boutons */}
      {!isFinal && (
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
