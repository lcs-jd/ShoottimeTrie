import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useSSE } from '../hooks/useSSE.js';
import { apiFetch } from '../lib/api.js';

export default function AdminDashboard() {
  const { sessionId } = useParams();
  const [stats, setStats] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [watermarkDone, setWatermarkDone] = useState(0);
  const [watermarkTarget, setWatermarkTarget] = useState(0);
  const [error, setError] = useState('');
  const watermarkDoneRef = useRef(0);

  function loadStats() {
    apiFetch(`/api/sessions/${sessionId}/stats`)
      .then(r => r.json())
      .then(setStats)
      .catch(console.error);
  }

  useEffect(() => {
    loadStats();
  }, [sessionId]);

  useSSE(sessionId, useCallback((event) => {
    if (event.type === 'watermark_done') {
      watermarkDoneRef.current += 1;
      setWatermarkDone(watermarkDoneRef.current);
      loadStats();
      // Fin du traitement : on a reçu autant d'événements que de jobs lancés
      setWatermarkTarget(prev => {
        if (watermarkDoneRef.current >= prev && prev > 0) {
          setProcessing(false);
        }
        return prev;
      });
    } else if (event.type === 'photo_sorted' || event.type === 'proxy_ready') {
      loadStats();
    }
  }, [sessionId]));

  async function startProcessing() {
    setProcessing(true);
    setError('');
    watermarkDoneRef.current = 0;
    setWatermarkDone(0);
    setWatermarkTarget(0);
    try {
      const res = await apiFetch(`/api/sessions/${sessionId}/process`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Erreur serveur');
      }
      const data = await res.json();
      setWatermarkTarget(data.queued);
    } catch (err) {
      setError(err.message);
      setProcessing(false);
    }
  }

  const counts = stats?.counts || {};
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const kept = counts.kept || 0;
  const discarded = counts.discarded || 0;
  const pending = counts.pending || 0;
  const watermarked = counts.watermarked || 0;

  const progressPct = watermarkTarget > 0 ? Math.round((watermarkDone / watermarkTarget) * 100) : 0;
  const allDone = processing && watermarkDone >= watermarkTarget && watermarkTarget > 0;

  return (
    <div className="page" style={{ maxWidth: 800 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <Link to={`/sort/${sessionId}`}>
          <button className="btn btn-ghost">← Retour au tri</button>
        </Link>
        <h1 className="page-title" style={{ margin: 0 }}>{stats?.session?.name || '...'}</h1>
      </div>

      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-value">{total}</div>
          <div className="stat-label">Total</div>
        </div>
        <div className="stat-card" style={{ borderColor: '#2a4a2a' }}>
          <div className="stat-value" style={{ color: 'var(--success)' }}>{kept}</div>
          <div className="stat-label">Gardées</div>
        </div>
        <div className="stat-card" style={{ borderColor: '#4a2a2a' }}>
          <div className="stat-value" style={{ color: 'var(--danger)' }}>{discarded}</div>
          <div className="stat-label">Rejetées</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: 'var(--text-muted)' }}>{pending}</div>
          <div className="stat-label">À trier</div>
        </div>
        <div className="stat-card" style={{ borderColor: '#3a3a1a' }}>
          <div className="stat-value" style={{ color: 'var(--accent)' }}>{watermarked}</div>
          <div className="stat-label">Filigrané</div>
        </div>
      </div>

      {pending > 0 && (
        <div className="card" style={{ marginBottom: 16, borderColor: '#3a2a0a' }}>
          <p style={{ color: 'var(--accent)', fontSize: 14 }}>
            ⚠ {pending} photo{pending > 1 ? 's' : ''} n'ont pas encore été triées.
          </p>
          <Link to={`/sort/${sessionId}`} style={{ display: 'inline-block', marginTop: 8 }}>
            <button className="btn btn-ghost" style={{ fontSize: 13 }}>Continuer le tri</button>
          </Link>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Filigranage</h2>

        {!processing ? (
          <>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 16 }}>
              {kept === 0
                ? "Aucune photo gardée à filigraner."
                : `${kept} photo${kept > 1 ? 's' : ''} gardée${kept > 1 ? 's' : ''} seront filigranée${kept > 1 ? 's' : ''} avec le logo PNG.`
              }
            </p>
            {error && <p style={{ color: 'var(--danger)', marginBottom: 12, fontSize: 13 }}>{error}</p>}
            <button
              className="btn btn-primary"
              onClick={startProcessing}
              disabled={kept === 0}
            >
              Lancer le filigranage ({kept} photos)
            </button>
          </>
        ) : (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 14 }}>
              <span>{allDone ? 'Traitement terminé' : 'Traitement en cours...'}</span>
              <span style={{ color: 'var(--accent)' }}>{watermarkDone} / {watermarkTarget}</span>
            </div>
            <div style={{
              height: 8,
              background: 'var(--border)',
              borderRadius: 4,
              overflow: 'hidden',
              marginBottom: 16,
            }}>
              <div style={{
                height: '100%',
                width: `${progressPct}%`,
                background: allDone ? 'var(--success)' : 'var(--accent)',
                borderRadius: 4,
                transition: 'width 0.3s ease',
              }} />
            </div>
            {allDone && (
              <p style={{ color: 'var(--success)', fontWeight: 600 }}>
                ✓ Filigranage terminé ! {watermarkDone} photos traitées.
              </p>
            )}
          </div>
        )}
      </div>

      {watermarked > 0 && (
        <div className="card">
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Téléchargement</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 16 }}>
            {watermarked} photo{watermarked > 1 ? 's' : ''} filigranée{watermarked > 1 ? 's' : ''} disponible{watermarked > 1 ? 's' : ''} au téléchargement.
          </p>
          <a href={`/api/sessions/${sessionId}/download`} download>
            <button className="btn btn-success">
              Télécharger le ZIP ({watermarked} photos)
            </button>
          </a>
        </div>
      )}
    </div>
  );
}
