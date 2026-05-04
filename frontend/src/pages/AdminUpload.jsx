import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api.js';
import Uppy from '@uppy/core';
import Dashboard from '@uppy/dashboard';
import XHRUpload from '@uppy/xhr-upload';
import '@uppy/core/dist/style.min.css';
import '@uppy/dashboard/dist/style.min.css';

export default function AdminUpload() {
  const [sessionName, setSessionName] = useState('');
  const [session, setSession] = useState(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const uppyRef = useRef(null);
  const dashboardRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!session || !dashboardRef.current) return;
    const uppy = new Uppy({
      autoProceed: false,
      restrictions: { allowedFileTypes: ['image/*'], maxFileSize: 150 * 1024 * 1024 },
    });
    uppy.use(Dashboard, {
      target: dashboardRef.current, inline: true, height: 400,
      showProgressDetails: true, proudlyDisplayPoweredByUppy: false,
      locale: { strings: {
        dropPasteFiles: 'Glissez vos photos ici ou %{browseFiles}',
        browseFiles: 'parcourez', uploading: 'Upload en cours…',
        complete: 'Terminé', uploadFailed: 'Échec', retry: 'Réessayer', cancel: 'Annuler',
        filesUploadedOfTotal: { 0: '%{complete} sur %{smart_count} photo', 1: '%{complete} sur %{smart_count} photos' },
      }},
    });
    uppy.use(XHRUpload, {
      endpoint: `/api/sessions/${session.id}/upload`,
      limit: 3, retryDelays: [0, 1000, 3000, 5000],
      fieldName: 'file', bundle: false, withCredentials: true,
    });
    uppyRef.current = uppy;
    return () => { typeof uppy.destroy === 'function' ? uppy.destroy() : uppy.close?.({ reason: 'unmount' }); };
  }, [session]);

  async function createSession(e) {
    e.preventDefault();
    if (!sessionName.trim()) return;
    setCreating(true); setError('');
    try {
      const res = await apiFetch('/api/sessions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: sessionName.trim() }),
      });
      if (!res.ok) throw new Error('Erreur serveur');
      setSession(await res.json());
    } catch (err) { setError(err.message); }
    finally { setCreating(false); }
  }

  return (
    <div className="page fadein" style={{ maxWidth: 760 }}>
      <div className="page-header">
        <h1 className="page-title">Nouvel évènement</h1>
      </div>

      {!session ? (
        <div className="card">
          <p style={{ fontWeight: 500, marginBottom: 16, color: 'var(--text)' }}>Nommer l'évènement</p>
          <form onSubmit={createSession}>
            <label className="label">Nom</label>
            <input
              className="input"
              value={sessionName}
              onChange={e => setSessionName(e.target.value)}
              placeholder="Ex : Mariage Martin — Juin 2025"
              autoFocus
            />
            {error && <div className="alert alert-error" style={{ marginTop: 10 }}><span>✕</span> {error}</div>}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={creating || !sessionName.trim()}
              style={{ marginTop: 16 }}
            >
              {creating && <div className="spinner spinner-dark spinner-sm" />}
              {creating ? 'Création…' : 'Créer et uploader →'}
            </button>
          </form>
        </div>
      ) : (
        <div>
          <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 32, height: 32, background: 'rgba(34,197,94,.1)', border: '1px solid rgba(34,197,94,.3)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--success)', fontSize: 14 }}>✓</div>
              <div>
                <div style={{ fontWeight: 500, color: 'var(--text)' }}>{session.name}</div>
                <div style={{ fontSize: 12, color: 'var(--success)', marginTop: 1 }}>Évènement créé — uploadez vos photos</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/sort/${session.id}`)}>Aller au tri</button>
              <button className="btn btn-primary btn-sm" onClick={() => navigate(`/dashboard/${session.id}`)}>Dashboard</button>
            </div>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 500, color: 'var(--text)' }}>Upload des photos</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>JPG, PNG, RAW — 150 Mo max — 3 uploads simultanés</div>
            </div>
            <div ref={dashboardRef} />
          </div>
        </div>
      )}
    </div>
  );
}
