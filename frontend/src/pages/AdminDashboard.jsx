import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useSSE } from '../hooks/useSSE.js';
import { apiFetch } from '../lib/api.js';
import Uppy from '@uppy/core';
import UppyDashboard from '@uppy/dashboard';
import XHRUpload from '@uppy/xhr-upload';
import '@uppy/core/dist/style.min.css';
import '@uppy/dashboard/dist/style.min.css';

// Étape 2.5 : grille compacte pour définir l'ordre d'upload Facebook
function FbOrderGrid({ photos, sort, order, onSortChange, onOrderChange, onConfirm, onBack }) {
  // Applique le tri localement (les photos arrivent déjà chargées depuis la DB)
  const sorted = [...photos].sort((a, b) => {
    let va, vb;
    if (sort === 'taken_at') {
      va = a.taken_at ?? 9999999999;
      vb = b.taken_at ?? 9999999999;
    } else if (sort === 'date') {
      va = a.created_at ?? '';
      vb = b.created_at ?? '';
    } else {
      va = a.filename ?? '';
      vb = b.filename ?? '';
    }
    const cmp = va < vb ? -1 : va > vb ? 1 : 0;
    return order === 'asc' ? cmp : -cmp;
  });

  return (
    <>
      {/* Contrôles de tri */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>
          Ordre d'upload : {sorted.length} photo{sorted.length > 1 ? 's' : ''}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <select
            value={sort}
            onChange={e => onSortChange(e.target.value)}
            style={{
              background: 'var(--surface2)', color: 'var(--muted)',
              border: '1px solid var(--border2)', borderRadius: 'var(--radius)',
              padding: '5px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            <option value="filename">Nom de fichier</option>
            <option value="taken_at">Date de prise</option>
            <option value="date">Date d'upload</option>
          </select>
          <button
            onClick={() => onOrderChange(o => o === 'asc' ? 'desc' : 'asc')}
            title={order === 'asc' ? 'Croissant' : 'Décroissant'}
            style={{
              background: 'var(--surface2)', color: 'var(--muted)',
              border: '1px solid var(--border2)', borderRadius: 'var(--radius)',
              padding: '5px 9px', fontSize: 14, cursor: 'pointer', lineHeight: 1,
            }}
          >{order === 'asc' ? '↑' : '↓'}</button>
        </div>
      </div>

      {/* Grille compacte */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))',
        gap: 6,
        maxHeight: 360,
        overflowY: 'auto',
        marginBottom: 14,
        padding: 2,
      }}>
        {sorted.map((photo, idx) => (
          <div key={photo.id} style={{ position: 'relative' }}>
            {photo.proxy_path ? (
              <img
                src={`/media/${photo.proxy_path}`}
                title={photo.filename}
                style={{
                  width: '100%', aspectRatio: '1', objectFit: 'cover',
                  borderRadius: 4, border: '1px solid var(--border)', display: 'block',
                }}
              />
            ) : (
              <div style={{
                width: '100%', aspectRatio: '1', borderRadius: 4,
                background: 'var(--surface)', border: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, color: 'var(--dim)',
              }}>
                {photo.filename?.slice(-8) || '?'}
              </div>
            )}
            {/* Numéro d'ordre */}
            <div style={{
              position: 'absolute', top: 3, left: 3,
              background: 'rgba(0,0,0,0.65)', color: '#fff',
              fontSize: 10, fontWeight: 700, lineHeight: 1,
              padding: '2px 4px', borderRadius: 3,
            }}>
              {idx + 1}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn btn-primary" onClick={() => onConfirm(sorted.map(p => p.id))}>
          ↗ Confirmer l'ordre et publier
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginLeft: 'auto' }}>
          ← Retour
        </button>
      </div>
    </>
  );
}

export default function AdminDashboard() {
  const { sessionId } = useParams();
  const [stats, setStats] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [watermarkDone, setWatermarkDone] = useState(0);
  const [watermarkTarget, setWatermarkTarget] = useState(0);
  const [error, setError] = useState('');
  // fbStep : 0=idle 1=redirect 2=choose_album 2.5=order 3=publishing 4=done
  const [fbStep, setFbStep] = useState(0);
  const [fbAlbums, setFbAlbums] = useState([]);
  const [fbAlbumsLoading, setFbAlbumsLoading] = useState(false);
  const [fbAlbumsError, setFbAlbumsError] = useState('');
  const [fbSelectedAlbum, setFbSelectedAlbum] = useState(null);
  const [fbPublishing, setFbPublishing] = useState(false);
  const [fbDone, setFbDone] = useState(0);
  const [fbTotal, setFbTotal] = useState(0);
  const [fbError, setFbError] = useState('');
  const [fbAlbumId, setFbAlbumId] = useState(null);
  const [fbPhotoResults, setFbPhotoResults] = useState([]);
  const [fbStatusLoading, setFbStatusLoading] = useState(true);
  const [fbPageUrl, setFbPageUrl] = useState('https://www.facebook.com/pages/manage');
  // Photos filigranées pour l'étape d'ordre
  const [fbOrderPhotos, setFbOrderPhotos] = useState([]);
  const [fbOrderSort, setFbOrderSort] = useState('filename');
  const [fbOrderDir, setFbOrderDir] = useState('asc');
  // État reset
  const [fbResetting, setFbResetting] = useState(false);
  const [fbResetError, setFbResetError] = useState('');
  const fbDoneRef = useRef(0);
  const fbTotalRef = useRef(0);
  const [showUpload, setShowUpload] = useState(false);
  const [duplicates, setDuplicates] = useState([]);
  const watermarkDoneRef = useRef(0);
  const dashboardRef = useRef(null);
  const uppyRef = useRef(null);

  function loadStats() {
    apiFetch(`/api/sessions/${sessionId}/stats`).then(r => r.json()).then(setStats).catch(console.error);
  }
  useEffect(() => { loadStats(); }, [sessionId]);

  useEffect(() => {
    apiFetch('/api/settings').then(r => r.json()).then(data => {
      if (data.facebook_page_url) setFbPageUrl(data.facebook_page_url);
    }).catch(() => {});
  }, []);

  // Reconstitue l'état Facebook au montage (retour sur la page, rechargement)
  useEffect(() => {
    apiFetch(`/api/sessions/${sessionId}/facebook-status`)
      .then(r => r.json())
      .then(data => {
        if (!data.album) { setFbStatusLoading(false); return; }

        setFbAlbumId(data.album.album_id);
        setFbSelectedAlbum({ id: data.album.album_id, name: data.album.album_name });
        setFbPhotoResults(data.photos || []);

        if (data.isPublishing) {
          const done = data.published + data.errors;
          fbDoneRef.current = done;
          fbTotalRef.current = data.total;
          setFbDone(done);
          setFbTotal(data.total);
          setFbPublishing(true);
          setFbStep(3);
        } else if (data.published > 0 || data.errors > 0) {
          fbDoneRef.current = data.published + data.errors;
          fbTotalRef.current = data.published + data.errors;
          setFbDone(data.published + data.errors);
          setFbTotal(data.published + data.errors);
          setFbStep(4);
        }
        setFbStatusLoading(false);
      })
      .catch(() => setFbStatusLoading(false));
  }, [sessionId]);

  useSSE(sessionId, useCallback((event) => {
    if (event.type === 'watermark_done') {
      watermarkDoneRef.current += 1;
      setWatermarkDone(watermarkDoneRef.current);
      loadStats();
      setWatermarkTarget(prev => {
        if (watermarkDoneRef.current >= prev && prev > 0) setProcessing(false);
        return prev;
      });
    } else if (event.type === 'facebook_progress') {
      fbDoneRef.current += 1;
      fbTotalRef.current = event.total;
      setFbDone(fbDoneRef.current);
      setFbTotal(event.total);
      setFbPhotoResults(prev => [...prev, { id: event.photoId, status: 'published' }]);
      if (fbDoneRef.current >= event.total) {
        setFbPublishing(false); setFbStep(4); loadStats();
      }
    } else if (event.type === 'facebook_error') {
      fbDoneRef.current += 1;
      setFbDone(fbDoneRef.current);
      setFbPhotoResults(prev => [...prev, { id: event.photoId, status: 'facebook_error', error: event.error }]);
      if (fbTotalRef.current > 0 && fbDoneRef.current >= fbTotalRef.current) {
        setFbPublishing(false); setFbStep(4); loadStats();
      }
    } else if (event.type === 'photo_sorted' || event.type === 'proxy_ready' || event.type === 'upload_done') {
      loadStats();
    }
  }, [sessionId]));

  // Initialiser Uppy quand la zone d'upload est affichée
  useEffect(() => {
    if (!showUpload || !dashboardRef.current) return;

    const uppy = new Uppy({
      autoProceed: false,
      restrictions: { allowedFileTypes: ['image/*'], maxFileSize: 150 * 1024 * 1024 },
    });

    uppy.use(UppyDashboard, {
      target: dashboardRef.current, inline: true, height: 320,
      showProgressDetails: true, proudlyDisplayPoweredByUppy: false,
      locale: { strings: {
        dropPasteFiles: 'Glissez vos photos ici ou %{browseFiles}',
        browseFiles: 'parcourez', uploading: 'Upload en cours…',
        complete: 'Terminé', uploadFailed: 'Échec', retry: 'Réessayer', cancel: 'Annuler',
        filesUploadedOfTotal: { 0: '%{complete} sur %{smart_count} photo', 1: '%{complete} sur %{smart_count} photos' },
      }},
    });

    uppy.use(XHRUpload, {
      endpoint: `/api/sessions/${sessionId}/upload`,
      limit: 3, retryDelays: [0, 1000, 3000, 5000],
      fieldName: 'file', bundle: false, withCredentials: true,
      getResponseData: (text) => { try { return JSON.parse(text); } catch { return {}; } },
    });

    uppy.on('upload-success', (file, response) => {
      const dups = response.body?.duplicates;
      if (dups?.length) setDuplicates(prev => [...new Set([...prev, ...dups])]);
    });

    uppy.on('complete', loadStats);

    uppyRef.current = uppy;
    return () => {
      typeof uppy.destroy === 'function' ? uppy.destroy() : uppy.close?.({ reason: 'unmount' });
      uppyRef.current = null;
    };
  }, [showUpload, sessionId]);

  async function loadFbAlbums() {
    setFbAlbumsLoading(true); setFbAlbumsError(''); setFbSelectedAlbum(null);
    try {
      const res = await apiFetch('/api/facebook-albums');
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Erreur serveur'); }
      const data = await res.json();
      setFbAlbums(data.albums || []);
      setFbStep(2);
    } catch (err) {
      setFbAlbumsError(err.message);
    } finally {
      setFbAlbumsLoading(false);
    }
  }

  // Charge les photos filigranées puis passe à l'étape d'ordre
  async function goToOrderStep() {
    try {
      const res = await apiFetch(`/api/sessions/${sessionId}/photos?status=watermarked&sort=filename&order=asc`);
      const photos = await res.json();
      setFbOrderPhotos(photos);
      setFbOrderSort('filename');
      setFbOrderDir('asc');
      setFbStep(2.5);
    } catch {
      setFbError('Impossible de charger les photos filigranées.');
    }
  }

  async function publishToFacebook(photoIds) {
    if (!fbSelectedAlbum) return;
    setFbPublishing(true); setFbError(''); setFbAlbumId(null);
    fbDoneRef.current = 0; fbTotalRef.current = 0;
    setFbDone(0); setFbTotal(0); setFbPhotoResults([]);
    setFbStep(3);
    try {
      const res = await apiFetch(`/api/sessions/${sessionId}/publish-facebook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          albumId: fbSelectedAlbum.id,
          albumName: fbSelectedAlbum.name,
          photoIds: photoIds || undefined,
        }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Erreur serveur'); }
      const data = await res.json();
      fbTotalRef.current = data.queued;
      setFbTotal(data.queued);
      setFbAlbumId(data.albumId);
      if (data.queued === 0) { setFbPublishing(false); setFbStep(4); }
    } catch (err) { setFbError(err.message); setFbPublishing(false); setFbStep(2.5); }
  }

  async function resetFacebook(scope) {
    setFbResetting(true); setFbResetError('');
    try {
      const res = await apiFetch(`/api/sessions/${sessionId}/reset-facebook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Erreur serveur'); }
      // Réinitialise le stepper et recharge les stats
      setFbStep(0);
      setFbSelectedAlbum(null);
      setFbAlbums([]);
      fbDoneRef.current = 0; fbTotalRef.current = 0;
      setFbDone(0); setFbTotal(0); setFbError('');
      setFbAlbumId(null); setFbPhotoResults([]);
      loadStats();
    } catch (err) {
      setFbResetError(err.message);
    } finally {
      setFbResetting(false);
    }
  }

  async function startProcessing(reprocess = false) {
    setProcessing(true); setError('');
    watermarkDoneRef.current = 0; setWatermarkDone(0); setWatermarkTarget(0);
    const endpoint = reprocess ? 'reprocess' : 'process';
    try {
      const res = await apiFetch(`/api/sessions/${sessionId}/${endpoint}`, { method: 'POST' });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Erreur serveur'); }
      setWatermarkTarget((await res.json()).queued);
    } catch (err) { setError(err.message); setProcessing(false); }
  }

  const counts = stats?.counts || {};
  const total        = Object.values(counts).reduce((a, b) => a + b, 0);
  const kept         = counts.kept || 0;
  const discarded    = counts.discarded || 0;
  const pending      = counts.pending || 0;
  const watermarked  = counts.watermarked || 0;
  const published    = counts.published || 0;
  const fbErrCount   = counts.facebook_error || 0;
  const progressPct = watermarkTarget > 0 ? Math.round((watermarkDone / watermarkTarget) * 100) : 0;
  const allDone     = processing && watermarkDone >= watermarkTarget && watermarkTarget > 0;

  // Étapes du stepper (1=créer album, 2=choisir album, 3=publier)
  const STEPPER_LABELS = ['Créer l\'album', 'Choisir l\'album', 'Ordre & Publier'];
  function stepperState(stepIdx) {
    // stepIdx : 0,1,2 correspondant aux 3 étapes visuelles
    const active = fbStep === 1 ? 0 : fbStep === 2 ? 1 : (fbStep === 2.5 || fbStep === 3 || fbStep === 4) ? 2 : -1;
    if (stepIdx < active) return 'done';
    if (stepIdx === active) return 'active';
    return 'pending';
  }

  return (
    <div className="page fadein">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <Link to={`/sort/${sessionId}`}>
          <button className="btn btn-ghost btn-sm">← Tri</button>
        </Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: 'var(--text)' }}>{stats?.session?.name || '…'}</h1>
          <p style={{ fontSize: 12, color: 'var(--dim)', marginTop: 2 }}>Dashboard évènement</p>
        </div>
        <button
          className={`btn btn-sm ${showUpload ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => { setShowUpload(v => !v); setDuplicates([]); }}
        >
          ↑ Ajouter des photos
        </button>
      </div>

      {/* Stats */}
      <div className="stats-grid">
        {[
          { v: total,       l: 'Total',      c: 'var(--text)'    },
          { v: pending,     l: 'À trier',    c: 'var(--muted)'   },
          { v: kept,        l: 'Gardées',    c: 'var(--success)' },
          { v: discarded,   l: 'Rejetées',   c: 'var(--danger)'  },
          { v: watermarked, l: 'Filigrané',  c: 'var(--accent)'  },
          ...(published > 0  ? [{ v: published, l: 'Publiées ↗', c: '#1877f2' }] : []),
          ...(fbErrCount > 0 ? [{ v: fbErrCount, l: 'Erreur FB', c: 'var(--danger)' }] : []),
        ].map(({ v, l, c }) => (
          <div key={l} className="stat-card">
            <div className="stat-value" style={{ color: c }}>{v}</div>
            <div className="stat-label">{l}</div>
          </div>
        ))}
      </div>

      {/* Upload additionnel */}
      {showUpload && (
        <div className="card" style={{ marginBottom: 12, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <span style={{ fontWeight: 600, color: 'var(--text)' }}>Ajouter des photos</span>
              <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 8 }}>Les doublons (même nom de fichier) seront ignorés</span>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => { setShowUpload(false); setDuplicates([]); }}>✕</button>
          </div>
          {duplicates.length > 0 && (
            <div className="alert alert-warning" style={{ margin: '12px 16px', flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
              <span style={{ fontWeight: 600 }}>⚠ {duplicates.length} doublon{duplicates.length > 1 ? 's' : ''} ignoré{duplicates.length > 1 ? 's' : ''}</span>
              <div style={{ fontSize: 12, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {duplicates.map(f => (
                  <span key={f} style={{ background: 'rgba(245,158,11,.15)', padding: '1px 7px', borderRadius: 4, fontFamily: 'monospace' }}>{f}</span>
                ))}
              </div>
            </div>
          )}
          <div ref={dashboardRef} />
        </div>
      )}

      {/* Warning tri */}
      {pending > 0 && (
        <div className="alert alert-warning" style={{ marginBottom: 12, justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <span>⚠ {pending} photo{pending > 1 ? 's' : ''} non triée{pending > 1 ? 's' : ''}</span>
          <Link to={`/sort/${sessionId}`}>
            <button className="btn btn-ghost btn-sm">Continuer le tri →</button>
          </Link>
        </div>
      )}

      {/* Filigranage */}
      <div className="card" style={{ marginBottom: 12 }}>
        <p style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 14 }}>Filigranage</p>
        {!processing ? (
          <>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
              {kept === 0 && watermarked === 0
                ? 'Aucune photo gardée à filigraner.'
                : kept > 0
                  ? `${kept} photo${kept > 1 ? 's' : ''} prête${kept > 1 ? 's' : ''} pour le filigranage.`
                  : `${watermarked} photo${watermarked > 1 ? 's' : ''} déjà filigranée${watermarked > 1 ? 's' : ''}.`
              }
            </p>
            {error && <div className="alert alert-error" style={{ marginBottom: 12 }}><span>✕</span> {error}</div>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" onClick={() => startProcessing(false)} disabled={kept === 0}>
                ◈ Lancer ({kept} photos)
              </button>
              {watermarked > 0 && (
                <button
                  className="btn btn-ghost"
                  onClick={() => startProcessing(true)}
                  title="Refaire le filigranage de toutes les photos gardées et déjà filigranées (utile après changement de logo)"
                >
                  ↺ Relancer tout ({kept + watermarked} photos)
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
              <span style={{ color: 'var(--muted)' }}>{allDone ? '✓ Terminé' : 'En cours…'}</span>
              <span style={{ color: 'var(--accent)', fontFamily: 'monospace', fontSize: 12 }}>{watermarkDone} / {watermarkTarget}</span>
            </div>
            <div className="progress-track" style={{ marginBottom: 12 }}>
              <div className={`progress-bar${allDone ? ' done' : ''}`} style={{ width: `${progressPct}%` }} />
            </div>
            {allDone && <p style={{ fontSize: 13, color: 'var(--success)', fontWeight: 500 }}>✓ Terminé — {watermarkDone} photos traitées</p>}
          </>
        )}
      </div>

      {/* Téléchargement */}
      {(watermarked + published + fbErrCount) > 0 && (
        <div className="card" style={{ marginBottom: 12 }}>
          <p style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Téléchargement</p>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
            {watermarked + published + fbErrCount} photo{(watermarked + published + fbErrCount) > 1 ? 's' : ''} filigranée{(watermarked + published + fbErrCount) > 1 ? 's' : ''} disponible{(watermarked + published + fbErrCount) > 1 ? 's' : ''}
            {published > 0 && <span style={{ color: '#1877f2', marginLeft: 6 }}>({published} déjà publiée{published > 1 ? 's' : ''})</span>}
          </p>
          <a href={`/api/sessions/${sessionId}/download`} download>
            <button className="btn btn-success-outline">↓ Télécharger le ZIP ({watermarked + published + fbErrCount} photos)</button>
          </a>
        </div>
      )}

      {/* Publication Facebook */}
      {(watermarked > 0 || published > 0 || fbErrCount > 0 || fbStep > 0) && (
        <div className="card">
          {/* Titre */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <p style={{ fontWeight: 600, color: 'var(--text)', margin: 0 }}>Publication Facebook</p>
            {fbStep > 0 && fbStep < 3 && (
              <span style={{ fontSize: 11, color: 'var(--dim)', background: 'var(--surface)', padding: '2px 8px', borderRadius: 99, border: '1px solid var(--border)' }}>
                Étape {fbStep === 2.5 ? '3' : fbStep} / 3
              </span>
            )}
          </div>

          {/* ÉTAPE 0 — point d'entrée */}
          {fbStep === 0 && (
            fbStatusLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--muted)', fontSize: 13 }}>
                <div className="spinner" style={{ width: 14, height: 14 }} /> Vérification du statut…
              </div>
            ) : (
              <>
                <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
                  Publie {watermarked} photo{watermarked > 1 ? 's' : ''} dans un album sur ta Page Facebook.
                  L'album doit être créé manuellement depuis Facebook.
                </p>
                <button className="btn btn-primary" onClick={() => setFbStep(1)}>
                  ↗ Publier sur Facebook
                </button>
              </>
            )
          )}

          {/* ÉTAPE 1 — créer l'album sur Facebook */}
          {fbStep === 1 && (
            <>
              <FbStepper labels={STEPPER_LABELS} stepperState={stepperState} />
              <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 6 }}>
                1. Clique sur le bouton ci-dessous pour ouvrir ta Page Facebook dans un nouvel onglet.
              </p>
              <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
                2. Crée un nouvel album photo vide depuis ta Page, puis reviens ici.
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <a href={fbPageUrl} target="_blank" rel="noopener noreferrer">
                  <button className="btn btn-primary">↗ Ouvrir ma Page Facebook</button>
                </a>
                <button className="btn btn-ghost" onClick={loadFbAlbums} disabled={fbAlbumsLoading}>
                  {fbAlbumsLoading ? 'Chargement…' : 'J\'ai créé l\'album →'}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setFbStep(0)} style={{ marginLeft: 'auto' }}>
                  Annuler
                </button>
              </div>
              {fbAlbumsError && (
                <div className="alert alert-error" style={{ marginTop: 12 }}>
                  <span>✕</span> {fbAlbumsError}
                </div>
              )}
            </>
          )}

          {/* ÉTAPE 2 — choisir l'album */}
          {fbStep === 2 && (
            <>
              <FbStepper labels={STEPPER_LABELS} stepperState={stepperState} />
              <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
                Sélectionne l'album dans lequel publier les {watermarked} photos. Les albums avec des photos existantes sont affichés en grisé.
              </p>
              {fbAlbums.length === 0 ? (
                <div className="alert alert-warning" style={{ marginBottom: 12 }}>
                  <span>⚠</span> Aucun album trouvé sur ta Page. Crée-en un depuis Facebook d'abord.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14, maxHeight: 240, overflowY: 'auto' }}>
                  {fbAlbums.map(album => {
                    const isEmpty = (album.count || 0) === 0;
                    const selected = fbSelectedAlbum?.id === album.id;
                    return (
                      <button
                        key={album.id}
                        onClick={() => isEmpty && setFbSelectedAlbum(album)}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '10px 14px', borderRadius: 8, textAlign: 'left', cursor: isEmpty ? 'pointer' : 'not-allowed',
                          border: `2px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
                          background: selected ? 'rgba(var(--accent-rgb, 99,102,241),.08)' : isEmpty ? 'var(--surface)' : 'var(--bg)',
                          opacity: isEmpty ? 1 : 0.45,
                          transition: 'border-color .15s, background .15s',
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: selected ? 600 : 400, color: 'var(--text)', fontSize: 14 }}>{album.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 2 }}>
                            {isEmpty ? 'Vide — prêt à recevoir les photos' : `${album.count} photo${album.count > 1 ? 's' : ''} existante${album.count > 1 ? 's' : ''}`}
                          </div>
                        </div>
                        {selected && <span style={{ color: 'var(--accent)', fontSize: 18 }}>✓</span>}
                        {!isEmpty && <span style={{ fontSize: 11, color: 'var(--dim)' }}>non vide</span>}
                      </button>
                    );
                  })}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <button className="btn btn-primary" onClick={goToOrderStep} disabled={!fbSelectedAlbum}>
                  Définir l'ordre →
                </button>
                <button className="btn btn-ghost" onClick={loadFbAlbums} disabled={fbAlbumsLoading}>
                  {fbAlbumsLoading ? 'Actualisation…' : '↺ Actualiser la liste'}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setFbStep(1)} style={{ marginLeft: 'auto' }}>
                  ← Retour
                </button>
              </div>
              {fbError && <div className="alert alert-error" style={{ marginTop: 12 }}><span>✕</span> {fbError}</div>}
            </>
          )}

          {/* ÉTAPE 2.5 — ordre d'upload */}
          {fbStep === 2.5 && (
            <>
              <FbStepper labels={STEPPER_LABELS} stepperState={stepperState} />
              <FbOrderGrid
                photos={fbOrderPhotos}
                sort={fbOrderSort}
                order={fbOrderDir}
                onSortChange={setFbOrderSort}
                onOrderChange={setFbOrderDir}
                onConfirm={publishToFacebook}
                onBack={() => setFbStep(2)}
              />
              {fbError && <div className="alert alert-error" style={{ marginTop: 12 }}><span>✕</span> {fbError}</div>}
            </>
          )}

          {/* ÉTAPES 3 & 4 — publication en cours ou terminée */}
          {(fbStep === 3 || fbStep === 4) && (
            <>
              {/* En-tête statut */}
              <div style={{ marginBottom: 14 }}>
                {fbStep === 3 ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div className="spinner" style={{ width: 14, height: 14, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                      Publication dans « {fbSelectedAlbum?.name} »…
                    </span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: fbPhotoResults.some(p => p.status === 'facebook_error') ? 'var(--warning, #f59e0b)' : 'var(--success)' }}>
                      {fbPhotoResults.some(p => p.status === 'facebook_error')
                        ? `⚠ Terminé avec erreurs — ${fbPhotoResults.filter(p => p.status === 'published').length} publiée(s), ${fbPhotoResults.filter(p => p.status === 'facebook_error').length} en erreur`
                        : `✓ ${fbPhotoResults.filter(p => p.status === 'published').length} photo${fbPhotoResults.filter(p => p.status === 'published').length > 1 ? 's' : ''} publiée${fbPhotoResults.filter(p => p.status === 'published').length > 1 ? 's' : ''}`
                      }
                    </span>
                    {fbAlbumId && (
                      <a href={`https://www.facebook.com/media/set/?set=a.${fbAlbumId}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: 'var(--accent)' }}>
                        Voir l'album ↗
                      </a>
                    )}
                  </div>
                )}
              </div>

              {/* Barre de progression */}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--dim)', marginBottom: 6 }}>
                <span>{fbStep === 3 ? 'Envoi en cours…' : 'Terminé'}</span>
                <span style={{ fontFamily: 'monospace' }}>{fbDone} / {fbTotal}</span>
              </div>
              <div className="progress-track" style={{ marginBottom: 14 }}>
                <div
                  className={`progress-bar${fbStep === 4 ? ' done' : ''}`}
                  style={{ width: fbTotal > 0 ? `${Math.round((fbDone / fbTotal) * 100)}%` : '0%' }}
                />
              </div>

              {/* Photos en erreur */}
              {fbPhotoResults.filter(p => p.status === 'facebook_error').length > 0 && (
                <details style={{ marginBottom: 12 }}>
                  <summary style={{ fontSize: 12, color: 'var(--danger)', cursor: 'pointer', userSelect: 'none' }}>
                    ✕ {fbPhotoResults.filter(p => p.status === 'facebook_error').length} photo{fbPhotoResults.filter(p => p.status === 'facebook_error').length > 1 ? 's' : ''} en erreur
                  </summary>
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
                    {fbPhotoResults.filter(p => p.status === 'facebook_error').map(p => (
                      <div key={p.id} style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--danger)', background: 'rgba(239,68,68,.08)', padding: '4px 8px', borderRadius: 4 }}>
                        {p.filename || p.id}{p.error ? ` — ${p.error}` : ''}
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {/* Photos publiées */}
              {fbStep === 4 && fbPhotoResults.filter(p => p.status === 'published').length > 0 && (
                <details style={{ marginBottom: 12 }}>
                  <summary style={{ fontSize: 12, color: 'var(--success)', cursor: 'pointer', userSelect: 'none' }}>
                    ✓ {fbPhotoResults.filter(p => p.status === 'published').length} photo{fbPhotoResults.filter(p => p.status === 'published').length > 1 ? 's' : ''} publiée{fbPhotoResults.filter(p => p.status === 'published').length > 1 ? 's' : ''}
                  </summary>
                  <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 200, overflowY: 'auto' }}>
                    {fbPhotoResults.filter(p => p.status === 'published').map(p => (
                      p.proxy_path ? (
                        <img
                          key={p.id}
                          src={`/media/${p.proxy_path}`}
                          title={p.filename || p.id}
                          style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--border)' }}
                        />
                      ) : (
                        <div key={p.id} style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--dim)', background: 'var(--surface)', padding: '3px 7px', borderRadius: 4 }}>
                          {p.filename || p.id}
                        </div>
                      )
                    ))}
                  </div>
                </details>
              )}

              {/* Actions fin — relancement */}
              {fbStep === 4 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
                  {/* Relancer les erreurs uniquement */}
                  {fbPhotoResults.some(p => p.status === 'facebook_error') && (
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => resetFacebook('errors_only')}
                      disabled={fbResetting}
                      title="Remet uniquement les photos en erreur en watermarked pour les republier"
                    >
                      {fbResetting ? '…' : '↺ Relancer les erreurs'}
                    </button>
                  )}
                  {/* Tout relancer */}
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => resetFacebook('all')}
                    disabled={fbResetting}
                    title="Remet toutes les photos (publiées + erreurs) en watermarked et recommence depuis zéro"
                  >
                    {fbResetting ? '…' : '↺ Tout relancer depuis zéro'}
                  </button>
                  {/* Republier dans un autre album */}
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => { setFbStep(0); setFbSelectedAlbum(null); setFbAlbums([]); fbDoneRef.current = 0; fbTotalRef.current = 0; setFbDone(0); setFbTotal(0); setFbError(''); setFbAlbumId(null); setFbPhotoResults([]); }}
                  >
                    Republier dans un autre album
                  </button>
                  {fbResetError && <span style={{ fontSize: 12, color: 'var(--danger)' }}>{fbResetError}</span>}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Stepper visuel réutilisable
function FbStepper({ labels, stepperState }) {
  return (
    <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
      {labels.map((label, i) => {
        const state = stepperState(i);
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
            <div style={{
              width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700, flexShrink: 0,
              background: state === 'active' ? 'var(--accent)' : state === 'done' ? 'var(--success)' : 'var(--surface)',
              color: state !== 'pending' ? '#fff' : 'var(--dim)',
              border: `1px solid ${state === 'active' ? 'var(--accent)' : state === 'done' ? 'var(--success)' : 'var(--border)'}`,
            }}>
              {state === 'done' ? '✓' : i + 1}
            </div>
            <span style={{ fontSize: 12, color: state !== 'pending' ? 'var(--text)' : 'var(--dim)', whiteSpace: 'nowrap' }}>{label}</span>
            {i < labels.length - 1 && <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />}
          </div>
        );
      })}
    </div>
  );
}
