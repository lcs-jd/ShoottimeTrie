import { useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

const STATUS = {
  pending:        { label: 'À trier',    color: 'var(--muted)'   },
  kept:           { label: 'Gardée',     color: 'var(--success)' },
  discarded:      { label: 'Rejetée',    color: 'var(--danger)'  },
  watermarked:    { label: 'Filigrané',  color: 'var(--accent)'  },
  published:      { label: 'Publié ↗',   color: '#1877f2'        },
  facebook_error: { label: 'Erreur FB',  color: 'var(--danger)'  },
};

export default function PhotoModal({ photo, index, total, onClose, onKeep, onDiscard, onPrev, onNext }) {
  const proxyUrl = photo.proxy_path ? `/media/${photo.proxy_path}` : null;
  const s = STATUS[photo.status] || STATUS.pending;
  const isFinal     = photo.status === 'watermarked' || photo.status === 'published' || photo.status === 'facebook_error';
  const isKept      = photo.status === 'kept';
  const isDiscarded = photo.status === 'discarded';

  const handleKey = useCallback((e) => {
    if      (e.key === 'Escape')                              onClose();
    else if (e.key === 'ArrowLeft'  || e.key === 'a')         onPrev();
    else if (e.key === 'ArrowRight' || e.key === 'd')         onNext();
    else if ((e.key === 'k' || e.key === 'Enter') && !isFinal && !isKept)      onKeep();
    else if ((e.key === 'x' || e.key === 'Backspace') && !isFinal && !isDiscarded) onDiscard();
  }, [onClose, onPrev, onNext, onKeep, onDiscard, isFinal, isKept, isDiscarded]);

  useEffect(() => {
    document.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [handleKey]);

  const modal = (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.92)',
        display: 'flex', flexDirection: 'column',
      }}
      onClick={onClose}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px',
          background: 'var(--surface)',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
        onClick={e => e.stopPropagation()}
      >
        <span style={{ fontSize: 12, color: 'var(--dim)', minWidth: 48 }}>{index + 1} / {total}</span>
        <span style={{ flex: 1, fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{photo.filename}</span>
        <span style={{ fontSize: 12, fontWeight: 500, color: s.color, flexShrink: 0 }}>{s.label}</span>
        <button
          onClick={onClose}
          style={{
            width: 28, height: 28, borderRadius: 6, flexShrink: 0,
            background: 'var(--surface2)', color: 'var(--muted)',
            border: '1px solid var(--border2)', cursor: 'pointer',
            fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >✕</button>
      </div>

      {/* Zone image — prend tout l'espace restant */}
      <div
        style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#080808' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Bouton précédent */}
        <button
          onClick={onPrev}
          disabled={index === 0}
          style={{
            position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
            zIndex: 2, width: 44, height: 60, borderRadius: 8,
            background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 28,
            border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            opacity: index === 0 ? 0.2 : 1,
          }}
        >‹</button>

        {/* Image centrée */}
        {proxyUrl ? (
          <img
            src={proxyUrl}
            alt={photo.filename}
            style={{
              position: 'absolute', inset: 0,
              width: '100%', height: '100%',
              objectFit: 'contain',
              padding: '8px 66px',
              boxSizing: 'border-box',
            }}
          />
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, color: 'var(--dim)' }}>
            <div className="spinner" />
            <span>Génération…</span>
          </div>
        )}

        {/* Bouton suivant */}
        <button
          onClick={onNext}
          disabled={index === total - 1}
          style={{
            position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
            zIndex: 2, width: 44, height: 60, borderRadius: 8,
            background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 28,
            border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            opacity: index === total - 1 ? 0.2 : 1,
          }}
        >›</button>
      </div>

      {/* Boutons Garder / Rejeter */}
      {!isFinal && (
        <div
          style={{
            display: 'flex', gap: 8, padding: '10px 14px',
            background: 'var(--surface)',
            borderTop: '1px solid var(--border)',
            flexShrink: 0,
          }}
          onClick={e => e.stopPropagation()}
        >
          <button
            disabled={isKept}
            onClick={onKeep}
            style={{
              flex: 1, padding: '10px 0', borderRadius: 7,
              fontSize: 14, fontWeight: 500, cursor: isKept ? 'default' : 'pointer',
              color: 'var(--success)',
              background: isKept ? 'rgba(34,197,94,0.12)' : 'transparent',
              border: '1px solid rgba(34,197,94,0.35)',
              opacity: isKept ? 0.6 : 1,
            }}
          >{isKept ? '✓ Gardée' : '✓ Garder'}</button>
          <button
            disabled={isDiscarded}
            onClick={onDiscard}
            style={{
              flex: 1, padding: '10px 0', borderRadius: 7,
              fontSize: 14, fontWeight: 500, cursor: isDiscarded ? 'default' : 'pointer',
              color: 'var(--danger)',
              background: isDiscarded ? 'rgba(239,68,68,0.12)' : 'transparent',
              border: '1px solid rgba(239,68,68,0.35)',
              opacity: isDiscarded ? 0.6 : 1,
            }}
          >{isDiscarded ? '✕ Rejetée' : '✕ Rejeter'}</button>
        </div>
      )}

      {/* Raccourcis */}
      <div
        style={{
          padding: '5px 14px 8px', fontSize: 11, color: 'var(--dim)',
          textAlign: 'center', background: 'var(--surface)',
          borderTop: '1px solid var(--border)', flexShrink: 0,
        }}
        onClick={e => e.stopPropagation()}
      >
        ← → naviguer &nbsp;·&nbsp; K garder &nbsp;·&nbsp; X rejeter &nbsp;·&nbsp; Échap fermer
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
