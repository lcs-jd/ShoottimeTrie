import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import Masonry from 'react-masonry-css';
import PhotoCard from '../components/PhotoCard.jsx';
import { useSSE } from '../hooks/useSSE.js';
import { apiFetch } from '../lib/api.js';

const BREAKPOINTS = {
  default: 4,
  1100: 3,
  700: 2,
  500: 1,
};

const FILTERS = ['all', 'pending', 'kept', 'discarded'];
const FILTER_LABELS = { all: 'Toutes', pending: 'À trier', kept: 'Gardées', discarded: 'Rejetées' };

export default function SortingGallery() {
  const { sessionId } = useParams();
  const [photos, setPhotos] = useState([]);
  const [filter, setFilter] = useState('all');
  const [session, setSession] = useState(null);

  useEffect(() => {
    apiFetch(`/api/sessions/${sessionId}`)
      .then(r => r.json())
      .then(setSession)
      .catch(console.error);

    apiFetch(`/api/sessions/${sessionId}/photos`)
      .then(r => r.json())
      .then(setPhotos)
      .catch(console.error);
  }, [sessionId]);

  useSSE(sessionId, useCallback((event) => {
    if (event.type === 'photo_sorted') {
      setPhotos(prev => prev.map(p =>
        p.id === event.photoId ? { ...p, status: event.status } : p
      ));
    } else if (event.type === 'keep_all') {
      setPhotos(prev => prev.map(p => p.status !== 'discarded' ? { ...p, status: 'kept' } : p));
    } else if (event.type === 'proxy_ready') {
      apiFetch(`/api/sessions/${sessionId}/photos`)
        .then(r => r.json())
        .then(setPhotos)
        .catch(console.error);
    } else if (event.type === 'upload_done') {
      apiFetch(`/api/sessions/${sessionId}/photos`)
        .then(r => r.json())
        .then(setPhotos)
        .catch(console.error);
    }
  }, [sessionId]));

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

  const visible = filter === 'all' ? photos : photos.filter(p => p.status === filter);

  const counts = photos.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="page" style={{ maxWidth: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 className="page-title" style={{ marginBottom: 4 }}>{session?.name || '...'}</h1>
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {photos.length} photos · {counts.pending || 0} à trier · {counts.kept || 0} gardées · {counts.discarded || 0} rejetées
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-secondary"
            onClick={keepAll}
            disabled={photos.filter(p => p.status !== 'discarded').length === 0}
            title="Valider toutes les photos non rejetées"
          >
            Tout valider
          </button>
          <Link to={`/dashboard/${sessionId}`}>
            <button className="btn btn-primary">Dashboard →</button>
          </Link>
        </div>
      </div>

      <div className="filter-bar">
        {FILTERS.map(f => (
          <button
            key={f}
            className={`filter-btn ${filter === f ? 'active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {FILTER_LABELS[f]}
            {f !== 'all' && counts[f] ? ` (${counts[f]})` : ''}
          </button>
        ))}
      </div>

      {visible.length === 0 && (
        <p style={{ color: 'var(--text-muted)', marginTop: 40, textAlign: 'center' }}>
          {photos.length === 0 ? 'Aucune photo uploadée pour cette session.' : 'Aucune photo dans ce filtre.'}
        </p>
      )}

      <Masonry
        breakpointCols={BREAKPOINTS}
        className="my-masonry-grid"
        columnClassName="my-masonry-grid_column"
      >
        {visible.map(photo => (
          <PhotoCard
            key={photo.id}
            photo={photo}
            onKeep={() => keep(photo.id)}
            onDiscard={() => discard(photo.id)}
          />
        ))}
      </Masonry>
    </div>
  );
}
