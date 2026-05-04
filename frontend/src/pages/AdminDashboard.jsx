import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useSSE } from '../hooks/useSSE.js';
import { apiFetch } from '../lib/api.js';
import Uppy from '@uppy/core';
import UppyDashboard from '@uppy/dashboard';
import XHRUpload from '@uppy/xhr-upload';
import '@uppy/core/dist/style.min.css';
import '@uppy/dashboard/dist/style.min.css';

export default function AdminDashboard() {
  const { sessionId } = useParams();
  const [stats, setStats] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [watermarkDone, setWatermarkDone] = useState(0);
  const [watermarkTarget, setWatermarkTarget] = useState(0);
  const [error, setError] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [duplicates, setDuplicates] = useState([]);
  const watermarkDoneRef = useRef(0);
  const dashboardRef = useRef(null);
  const uppyRef = useRef(null);

  function loadStats() {
    apiFetch(`/api/sessions/${sessionId}/stats`).then(r => r.json()).then(setStats).catch(console.error);
  }
  useEffect(() => { loadStats(); }, [sessionId]);

  useSSE(sessionId, useCallback((event) => {
    if (event.type === 'watermark_done') {
      watermarkDoneRef.current += 1;
      setWatermarkDone(watermarkDoneRef.current);
      loadStats();
      setWatermarkTarget(prev => {
        if (watermarkDoneRef.current >= prev && prev > 0) setProcessing(false);
        return prev;
      });
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
  const total       = Object.values(counts).reduce((a, b) => a + b, 0);
  const kept        = counts.kept || 0;
  const discarded   = counts.discarded || 0;
  const pending     = counts.pending || 0;
  const watermarked = counts.watermarked || 0;
  const progressPct = watermarkTarget > 0 ? Math.round((watermarkDone / watermarkTarget) * 100) : 0;
  const allDone     = processing && watermarkDone >= watermarkTarget && watermarkTarget > 0;

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
          { v: total,       l: 'Total',     c: 'var(--text)'    },
          { v: pending,     l: 'À trier',   c: 'var(--muted)'   },
          { v: kept,        l: 'Gardées',   c: 'var(--success)' },
          { v: discarded,   l: 'Rejetées',  c: 'var(--danger)'  },
          { v: watermarked, l: 'Filigrané', c: 'var(--accent)'  },
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
      {watermarked > 0 && (
        <div className="card">
          <p style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>Téléchargement</p>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
            {watermarked} photo{watermarked > 1 ? 's' : ''} filigranée{watermarked > 1 ? 's' : ''} disponible{watermarked > 1 ? 's' : ''}
          </p>
          <a href={`/api/sessions/${sessionId}/download`} download>
            <button className="btn btn-success-outline">↓ Télécharger le ZIP ({watermarked} photos)</button>
          </a>
        </div>
      )}
    </div>
  );
}
