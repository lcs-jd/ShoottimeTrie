import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import Masonry from 'react-masonry-css';
import PhotoCard from '../components/PhotoCard.jsx';
import PhotoModal from '../components/PhotoModal.jsx';
import EmailDialog from '../components/EmailDialog.jsx';
import { useSSE } from '../hooks/useSSE.js';
import { apiFetch } from '../lib/api.js';

const BREAKPOINTS = { default: 4, 1280: 4, 1024: 3, 768: 2, 480: 1 };
const FILTERS = [
  { key: 'all',            label: 'Toutes'    },
  { key: 'pending',        label: 'À trier'   },
  { key: 'kept',           label: 'Gardées'   },
  { key: 'discarded',      label: 'Rejetées'  },
  { key: 'watermarked',    label: 'Filigrané' },
  { key: 'published',      label: 'Publiées'  },
  { key: 'facebook_error', label: 'Erreur FB' },
  { key: 'proxy_error',    label: 'Erreur proxy' },
];

export default function SortingGallery() {
  const { sessionId } = useParams();
  const [photos, setPhotos]         = useState([]);
  const [filter, setFilter]         = useState('all');
  const [sort, setSort]             = useState('filename');
  const [order, setOrder]           = useState('asc');
  const [session, setSession]       = useState(null);
  const [modalIndex, setModalIndex] = useState(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [emailPhotos, setEmailPhotos] = useState(null);
  const [toast, setToast]           = useState(null);

  useEffect(() => {
    apiFetch(`/api/sessions/${sessionId}`).then(r => r.json()).then(setSession).catch(console.error);
  }, [sessionId]);

  useEffect(() => {
    apiFetch(`/api/sessions/${sessionId}/photos?sort=${sort}&order=${order}`)
      .then(r => r.json()).then(setPhotos).catch(console.error);
  }, [sessionId, sort, order]);

  const { connected } = useSSE(sessionId, useCallback((event) => {
    if (event.type === 'photo_sorted') {
      setPhotos(prev => prev.map(p => p.id === event.photoId ? { ...p, status: event.status } : p));
    } else if (event.type === 'keep_all') {
      setPhotos(prev => prev.map(p => p.status !== 'discarded' ? { ...p, status: 'kept' } : p));
    } else if (event.type === 'discard_all') {
      setPhotos(prev => prev.map(p => (p.status === 'pending' || p.status === 'kept') ? { ...p, status: 'discarded' } : p));
    } else if (event.type === 'proxy_ready' || event.type === 'upload_done' || event.type === 'exif_ready') {
      apiFetch(`/api/sessions/${sessionId}/photos?sort=${sort}&order=${order}`)
        .then(r => r.json()).then(setPhotos).catch(console.error);
    } else if (event.type === 'proxy_error') {
      setPhotos(prev => prev.map(p => p.id === event.photoId ? { ...p, status: 'proxy_error' } : p));
    } else if (event.type === 'watermark_error') {
      setPhotos(prev => prev.map(p => p.id === event.photoId ? { ...p, status: 'kept' } : p));
    }
  }, [sessionId, sort, order]));

  async function keep(photoId) {
    await apiFetch(`/api/photos/${photoId}/keep`, { method: 'POST' });
    setPhotos(prev => prev.map(p => p.id === photoId ? { ...p, status: 'kept' } : p));
  }
  async function discard(photoId) {
    await apiFetch(`/api/photos/${photoId}/discard`, { method: 'POST' });
    setPhotos(prev => prev.map(p => p.id === photoId ? { ...p, status: 'discarded' } : p));
  }
  async function keepAll() {
    const res = await apiFetch(`/api/sessions/${sessionId}/keep-all`, { method: 'POST' });
    if (!res.ok) return;
    setPhotos(prev => prev.map(p => p.status !== 'discarded' ? { ...p, status: 'kept' } : p));
  }
  async function discardAll() {
    const n = photos.filter(p => p.status === 'pending' || p.status === 'kept').length;
    if (!window.confirm(`Rejeter ${n} photo${n > 1 ? 's' : ''} ? Les photos déjà filigranées ne sont pas concernées.`)) return;
    const res = await apiFetch(`/api/sessions/${sessionId}/discard-all`, { method: 'POST' });
    if (!res.ok) return;
    setPhotos(prev => prev.map(p => (p.status === 'pending' || p.status === 'kept') ? { ...p, status: 'discarded' } : p));
  }

  function toggleSelect(photoId) {
    setSelectedIds(prev => prev.includes(photoId) ? prev.filter(id => id !== photoId) : [...prev, photoId]);
  }
  function exitSelectMode() {
    setSelectMode(false);
    setSelectedIds([]);
  }

  const visible = filter === 'all' ? photos : photos.filter(p => p.status === filter);
  const counts  = photos.reduce((acc, p) => { acc[p.status] = (acc[p.status] || 0) + 1; return acc; }, {});

  const modalPhoto = modalIndex !== null ? visible[modalIndex] : null;

  async function modalKeep() {
    if (!modalPhoto) return;
    await keep(modalPhoto.id);
    if (modalIndex < visible.length - 1) setModalIndex(i => i + 1);
  }
  async function modalDiscard() {
    if (!modalPhoto) return;
    await discard(modalPhoto.id);
    if (modalIndex < visible.length - 1) setModalIndex(i => i + 1);
  }

  return (
    <div className="page-wide fadein">

      {/* Bandeau déconnexion SSE */}
      {!connected && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 14px', marginBottom: 12,
          background: 'rgba(245,158,11,0.08)',
          border: '1px solid rgba(245,158,11,0.25)',
          borderRadius: 'var(--radius)', fontSize: 13,
          color: 'var(--accent)',
        }}>
          <div className="spinner spinner-sm" style={{ borderTopColor: 'var(--accent)' }} />
          Connexion temps réel perdue — reconnexion en cours…
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <div className="breadcrumb">
            <Link to="/">Évènements</Link>
            <span className="breadcrumb-sep">›</span>
            <span style={{ color: 'var(--muted)' }}>{session?.name || '…'}</span>
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text)' }}>{session?.name || '…'}</h1>
          <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 12, color: 'var(--dim)', flexWrap: 'wrap' }}>
            <span>{photos.length} photos</span>
            {counts.pending        > 0 && <span style={{ color: 'var(--muted)' }}>{counts.pending} à trier</span>}
            {counts.kept           > 0 && <span style={{ color: 'var(--success)' }}>{counts.kept} gardées</span>}
            {counts.discarded      > 0 && <span style={{ color: 'var(--danger)' }}>{counts.discarded} rejetées</span>}
            {counts.watermarked    > 0 && <span style={{ color: 'var(--accent)' }}>{counts.watermarked} filigranées</span>}
            {counts.published      > 0 && <span style={{ color: '#1877f2' }}>{counts.published} publiées</span>}
            {counts.facebook_error > 0 && <span style={{ color: 'var(--danger)' }}>{counts.facebook_error} erreur FB</span>}
            {counts.proxy_error    > 0 && <span style={{ color: 'var(--danger)' }}>{counts.proxy_error} erreur miniature</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
          <select
            value={sort}
            onChange={e => setSort(e.target.value)}
            style={{
              background: 'var(--surface2)', color: 'var(--muted)',
              border: '1px solid var(--border2)', borderRadius: 'var(--radius)',
              padding: '5px 10px', fontSize: 12, cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <option value="filename">Nom de fichier</option>
            <option value="taken_at">Date de prise</option>
            <option value="date">Date d'upload</option>
            <option value="status">Statut</option>
          </select>
          <button
            onClick={() => setOrder(o => o === 'asc' ? 'desc' : 'asc')}
            title={order === 'asc' ? 'Ordre croissant' : 'Ordre décroissant'}
            style={{
              background: 'var(--surface2)', color: 'var(--muted)',
              border: '1px solid var(--border2)', borderRadius: 'var(--radius)',
              padding: '5px 9px', fontSize: 14, cursor: 'pointer', lineHeight: 1,
            }}
          >{order === 'asc' ? '↑' : '↓'}</button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={keepAll}
            disabled={photos.filter(p => p.status !== 'discarded').length === 0}
          >
            ✓ Tout valider
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={discardAll}
            disabled={photos.filter(p => p.status === 'pending' || p.status === 'kept').length === 0}
            style={{ color: 'var(--danger)' }}
          >
            ✕ Tout rejeter
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
            style={selectMode ? { color: 'var(--accent)', borderColor: 'rgba(245,158,11,0.45)' } : undefined}
          >
            {selectMode ? 'Annuler' : '☑ Sélectionner'}
          </button>
          <Link to={`/dashboard/${sessionId}`}>
            <button className="btn btn-primary btn-sm">Dashboard →</button>
          </Link>
        </div>
      </div>

      {/* Barre de sélection multiple */}
      {selectMode && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          padding: '10px 14px', marginBottom: 12,
          background: 'rgba(245,158,11,0.06)',
          border: '1px solid rgba(245,158,11,0.25)',
          borderRadius: 'var(--radius)',
        }}>
          <span style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 500 }}>
            {selectedIds.length} sélectionnée{selectedIds.length > 1 ? 's' : ''}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => setSelectedIds(visible.map(p => p.id))}>
            Tout sélectionner
          </button>
          {selectedIds.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={() => setSelectedIds([])}>Vider</button>
          )}
          <div style={{ flex: 1 }} />
          <button
            className="btn btn-primary btn-sm"
            disabled={selectedIds.length === 0}
            onClick={() => setEmailPhotos(photos.filter(p => selectedIds.includes(p.id)))}
          >
            ✉ Envoyer par email
          </button>
        </div>
      )}

      {/* Filtres */}
      <div className="filter-bar">
        {FILTERS.map(({ key, label }) => {
          if (key !== 'all' && !counts[key]) return null;
          return (
            <button
              key={key}
              className={`filter-btn${filter === key ? ' active' : ''}`}
              onClick={() => setFilter(key)}
            >
              {label}
              {key !== 'all' && counts[key] ? <span className="filter-count">{counts[key]}</span> : null}
            </button>
          );
        })}
      </div>

      {/* Vide */}
      {visible.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">🖼</div>
          <div className="empty-state-title">
            {photos.length === 0 ? 'Aucune photo uploadée' : 'Aucune photo dans ce filtre'}
          </div>
        </div>
      )}

      {/* Galerie */}
      <Masonry breakpointCols={BREAKPOINTS} className="masonry-grid" columnClassName="masonry-col">
        {visible.map((photo, idx) => (
          <PhotoCard
            key={photo.id}
            photo={photo}
            selectMode={selectMode}
            selected={selectedIds.includes(photo.id)}
            onToggleSelect={() => toggleSelect(photo.id)}
            onKeep={() => keep(photo.id)}
            onDiscard={() => discard(photo.id)}
            onExpand={() => setModalIndex(idx)}
          />
        ))}
      </Masonry>

      {/* Modal preview */}
      {modalPhoto && (
        <PhotoModal
          photo={modalPhoto}
          index={modalIndex}
          total={visible.length}
          onClose={() => setModalIndex(null)}
          onKeep={modalKeep}
          onDiscard={modalDiscard}
          onPrev={() => setModalIndex(i => Math.max(0, i - 1))}
          onNext={() => setModalIndex(i => Math.min(visible.length - 1, i + 1))}
          onEmail={(p) => setEmailPhotos([p])}
        />
      )}
      {/* Envoi par email */}
      {emailPhotos && (
        <EmailDialog
          photos={emailPhotos}
          onClose={() => setEmailPhotos(null)}
          onSent={(res) => {
            setToast(`Envoyé à ${res.sent} destinataire${res.sent > 1 ? 's' : ''} — ${res.attachments} pièce${res.attachments > 1 ? 's' : ''} jointe${res.attachments > 1 ? 's' : ''} (${res.sizeMb} Mo)`);
            setTimeout(() => setToast(null), 6000);
            exitSelectMode();
          }}
        />
      )}

      {/* Confirmation d'envoi */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
          zIndex: 10001, padding: '10px 18px', borderRadius: 8,
          background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.45)',
          color: 'var(--success)', fontSize: 13,
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}
