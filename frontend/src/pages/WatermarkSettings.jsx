import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../lib/api.js';

export default function WatermarkSettings() {
  const [preview, setPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef();

  useEffect(() => {
    apiFetch('/api/watermark').then(res => {
      if (res.ok) setPreview('/api/watermark?' + Date.now());
    }).catch(() => {});
  }, []);

  async function handleFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setMessage({ type: 'error', text: 'Sélectionnez une image (PNG recommandé).' }); return; }
    setUploading(true); setMessage(null);
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await apiFetch('/api/watermark', { method: 'POST', body: form });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Erreur serveur'); }
      setPreview('/api/watermark?' + Date.now());
      setMessage({ type: 'success', text: 'Filigrane mis à jour.' });
    } catch (err) { setMessage({ type: 'error', text: err.message }); }
    finally { setUploading(false); }
  }

  function onInputChange(e) { handleFile(e.target.files[0]); e.target.value = ''; }
  function onDrop(e) { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }

  return (
    <div className="page-sm fadein">
      <div className="page-header">
        <div>
          <h1 className="page-title">Filigrane</h1>
          <p className="page-subtitle">Logo appliqué en bas à droite des photos (15% de la largeur)</p>
        </div>
      </div>

      {/* Aperçu */}
      <div className="card" style={{ marginBottom: 12 }}>
        <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', marginBottom: 14 }}>Aperçu actuel</p>
        {preview ? (
          <div style={{
            background: 'repeating-conic-gradient(#222 0% 25%, #1a1a1a 0% 50%) 0 0 / 16px 16px',
            borderRadius: 8, padding: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 140,
          }}>
            <img src={preview} alt="Filigrane" style={{ maxWidth: '100%', maxHeight: 180, objectFit: 'contain' }} />
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--dim)' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>◈</div>
            <p style={{ fontSize: 13 }}>Aucun filigrane configuré</p>
          </div>
        )}
      </div>

      {/* Upload */}
      <div className="card">
        <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', marginBottom: 8 }}>
          {preview ? 'Remplacer le filigrane' : 'Configurer le filigrane'}
        </p>
        <p style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 16 }}>PNG avec transparence recommandé — 5 Mo max</p>

        <div
          className={`dropzone${dragOver ? ' drag-over' : ''}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          {uploading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <div className="spinner" />
              <p style={{ fontSize: 13, color: 'var(--muted)' }}>Upload en cours…</p>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 28, color: 'var(--dim)', marginBottom: 8 }}>↑</div>
              <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>Glissez une image ici</p>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={e => { e.stopPropagation(); inputRef.current?.click(); }}
              >
                Choisir un fichier
              </button>
            </>
          )}
          <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onInputChange} />
        </div>

        {message && (
          <div className={`alert ${message.type === 'error' ? 'alert-error' : 'alert-success'}`} style={{ marginTop: 12 }}>
            <span>{message.type === 'error' ? '✕' : '✓'}</span> {message.text}
          </div>
        )}
      </div>
    </div>
  );
}
