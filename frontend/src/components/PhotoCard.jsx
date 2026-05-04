import { useState } from 'react';

const statusBorder = {
  pending: '2px solid transparent',
  kept: '2px solid var(--success)',
  discarded: '2px solid var(--danger)',
  watermarked: '2px solid var(--accent)',
};

export default function PhotoCard({ photo, onKeep, onDiscard }) {
  const [loading, setLoading] = useState(false);

  const proxyUrl = photo.proxy_path ? `/media/${photo.proxy_path}` : null;

  async function handle(action) {
    if (loading) return;
    setLoading(true);
    try { await action(); } finally { setLoading(false); }
  }

  const isKept      = photo.status === 'kept';
  const isDiscarded = photo.status === 'discarded';
  const isPending   = photo.status === 'pending';
  const isWatermarked = photo.status === 'watermarked';

  return (
    <div style={{
      borderRadius: 'var(--radius)',
      overflow: 'hidden',
      background: 'var(--surface)',
      position: 'relative',
      border: statusBorder[photo.status] || '2px solid transparent',
      opacity: isDiscarded ? 0.4 : 1,
      transition: 'opacity 0.2s, border-color 0.2s',
    }}>
      {proxyUrl ? (
        <img
          src={proxyUrl}
          alt={photo.filename}
          loading="lazy"
          style={{ width: '100%', display: 'block' }}
        />
      ) : (
        <div style={{
          height: 160,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          fontSize: 13,
        }}>
          Génération...
        </div>
      )}

      {/* Badge statut */}
      <div style={{
        position: 'absolute',
        top: 6,
        right: 6,
        background: 'rgba(0,0,0,0.65)',
        borderRadius: 4,
        padding: '2px 8px',
        fontSize: 11,
        fontWeight: 600,
        color: isKept ? 'var(--success)'
             : isDiscarded ? 'var(--danger)'
             : isWatermarked ? 'var(--accent)'
             : 'var(--text-muted)',
      }}>
        {isPending ? '○ À trier'
         : isKept ? '✓ Gardée'
         : isDiscarded ? '✕ Rejetée'
         : '★ Filigrané'}
      </div>

      {/* Actions — toujours visibles sauf sur les filigranées */}
      {!isWatermarked && (
        <div style={{
          display: 'flex',
          gap: 6,
          padding: '8px',
          background: 'rgba(0,0,0,0.5)',
        }}>
          <button
            className="btn btn-success"
            style={{
              flex: 1,
              padding: '7px 0',
              fontSize: 12,
              justifyContent: 'center',
              opacity: isKept ? 0.5 : 1,
            }}
            disabled={loading || isKept}
            onClick={() => handle(onKeep)}
          >
            {isKept ? '✓ Gardée' : 'Garder'}
          </button>
          <button
            className="btn btn-danger"
            style={{
              flex: 1,
              padding: '7px 0',
              fontSize: 12,
              justifyContent: 'center',
              opacity: isDiscarded ? 0.5 : 1,
            }}
            disabled={loading || isDiscarded}
            onClick={() => handle(onDiscard)}
          >
            {isDiscarded ? '✕ Rejetée' : 'Rejeter'}
          </button>
        </div>
      )}
    </div>
  );
}
