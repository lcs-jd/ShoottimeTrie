import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../lib/api.js';

export default function WatermarkSettings() {
  const [preview, setPreview] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState(null);
  const inputRef = useRef();

  useEffect(() => {
    apiFetch('/api/watermark')
      .then(res => {
        if (res.ok) setPreview('/api/watermark?' + Date.now());
      })
      .catch(() => {});
  }, []);

  async function handleFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setMessage({ type: 'error', text: 'Sélectionnez une image (PNG recommandé).' });
      return;
    }
    setUploading(true);
    setMessage(null);

    const form = new FormData();
    form.append('file', file);

    try {
      const res = await apiFetch('/api/watermark', { method: 'POST', body: form });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Erreur serveur');
      }
      setPreview('/api/watermark?' + Date.now());
      setMessage({ type: 'success', text: 'Filigrane mis à jour.' });
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setUploading(false);
    }
  }

  function onInputChange(e) {
    handleFile(e.target.files[0]);
    e.target.value = '';
  }

  function onDrop(e) {
    e.preventDefault();
    handleFile(e.dataTransfer.files[0]);
  }

  return (
    <div className="page" style={{ maxWidth: 600 }}>
      <h1 className="page-title" style={{ marginBottom: 24 }}>Filigrane</h1>

      <div className="card" style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Filigrane actuel</h2>
        {preview ? (
          <div style={{
            background: 'repeating-conic-gradient(#333 0% 25%, #222 0% 50%) 0 0 / 20px 20px',
            borderRadius: 8,
            padding: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 160,
          }}>
            <img
              src={preview}
              alt="Filigrane"
              style={{ maxWidth: '100%', maxHeight: 200, objectFit: 'contain' }}
            />
          </div>
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Aucun filigrane configuré.</p>
        )}
      </div>

      <div className="card">
        <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Remplacer le filigrane</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>
          PNG avec transparence recommandé. Taille max : 5 Mo. Le logo sera appliqué en bas à droite des photos (15% de la largeur).
        </p>

        <div
          style={{
            border: '2px dashed var(--border)',
            borderRadius: 8,
            padding: 32,
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'border-color 0.2s',
          }}
          onClick={() => inputRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={onDrop}
        >
          <div style={{ fontSize: 32, marginBottom: 8 }}>🖼</div>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 12 }}>
            Glissez une image ici ou cliquez pour choisir
          </p>
          <button className="btn btn-primary" disabled={uploading}>
            {uploading ? 'Upload...' : 'Choisir un fichier'}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={onInputChange}
          />
        </div>

        {message && (
          <p style={{
            marginTop: 16,
            fontSize: 14,
            color: message.type === 'error' ? 'var(--danger)' : 'var(--success)',
          }}>
            {message.type === 'success' ? '✓ ' : '✗ '}{message.text}
          </p>
        )}
      </div>
    </div>
  );
}
