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

  // Initialiser Uppy après que le DOM du dashboard soit monté
  useEffect(() => {
    if (!session || !dashboardRef.current) return;

    const uppy = new Uppy({
      autoProceed: false,
      restrictions: {
        allowedFileTypes: ['image/*'],
        maxFileSize: 150 * 1024 * 1024,
      },
    });

    uppy.use(Dashboard, {
      target: dashboardRef.current,
      inline: true,
      height: 450,
      showProgressDetails: true,
      proudlyDisplayPoweredByUppy: false,
      locale: {
        strings: {
          dropPasteFiles: 'Glissez vos photos ici ou %{browseFiles}',
          browseFiles: 'parcourez',
          uploading: 'Upload en cours...',
          complete: 'Terminé',
          uploadFailed: 'Échec',
          retry: 'Réessayer',
          cancel: 'Annuler',
          filesUploadedOfTotal: {
            0: '%{complete} sur %{smart_count} photo uploadée',
            1: '%{complete} sur %{smart_count} photos uploadées',
          },
        },
      },
    });

    uppy.use(XHRUpload, {
      endpoint: `/api/sessions/${session.id}/upload`,
      limit: 3,
      retryDelays: [0, 1000, 3000, 5000],
      fieldName: 'file',
      bundle: false,
      withCredentials: true,
    });

    uppyRef.current = uppy;

    return () => {
      if (typeof uppy.destroy === 'function') uppy.destroy();
      else uppy.close?.({ reason: 'unmount' });
    };
  }, [session]);

  async function createSession(e) {
    e.preventDefault();
    if (!sessionName.trim()) return;
    setCreating(true);
    setError('');

    try {
      const res = await apiFetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: sessionName.trim() }),
      });
      if (!res.ok) throw new Error('Erreur serveur');
      const data = await res.json();
      setSession(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 800 }}>
      <h1 className="page-title">Nouvelle session d'upload</h1>

      {!session ? (
        <form onSubmit={createSession} className="card" style={{ maxWidth: 480 }}>
          <label style={{ display: 'block', marginBottom: 8, fontSize: 14, color: 'var(--text-muted)' }}>
            Nom de la session
          </label>
          <input
            value={sessionName}
            onChange={e => setSessionName(e.target.value)}
            placeholder="Ex: Mariage Martin 2024"
            autoFocus
          />
          {error && <p style={{ color: 'var(--danger)', marginTop: 8, fontSize: 13 }}>{error}</p>}
          <button
            type="submit"
            className="btn btn-primary"
            style={{ marginTop: 16 }}
            disabled={creating || !sessionName.trim()}
          >
            {creating ? 'Création...' : 'Créer et uploader'}
          </button>
        </form>
      ) : (
        <div>
          <div className="card" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 600 }}>{session.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Session créée</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => navigate(`/sort/${session.id}`)}>
                Aller au tri →
              </button>
              <button className="btn btn-primary" onClick={() => navigate(`/dashboard/${session.id}`)}>
                Dashboard
              </button>
            </div>
          </div>

          <div ref={dashboardRef} />
        </div>
      )}
    </div>
  );
}
