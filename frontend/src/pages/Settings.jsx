import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../lib/api.js';

export default function Settings() {
  const [tab, setTab] = useState('watermark');

  return (
    <div className="page-sm fadein">
      <div className="page-header">
        <div>
          <h1 className="page-title">Paramètres</h1>
          <p className="page-subtitle">Filigrane et configuration Facebook</p>
        </div>
      </div>

      {/* Onglets */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        {[{ id: 'watermark', label: '◈ Filigrane' }, { id: 'facebook', label: '↗ Facebook' }].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '8px 16px', fontSize: 13, fontWeight: tab === t.id ? 600 : 400,
              color: tab === t.id ? 'var(--text)' : 'var(--muted)',
              background: 'none', border: 'none', cursor: 'pointer',
              borderBottom: `2px solid ${tab === t.id ? 'var(--accent)' : 'transparent'}`,
              marginBottom: -1, transition: 'color .15s, border-color .15s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'watermark' && <WatermarkTab />}
      {tab === 'facebook'  && <FacebookTab />}
    </div>
  );
}

// ── Onglet Filigrane ──────────────────────────────────────────────────────────
function WatermarkTab() {
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
    <>
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
              <button type="button" className="btn btn-primary btn-sm" onClick={e => { e.stopPropagation(); inputRef.current?.click(); }}>
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
    </>
  );
}

// ── Onglet Facebook ───────────────────────────────────────────────────────────
function FacebookTab() {
  const [pageUrl, setPageUrl] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/api/settings')
      .then(r => r.json())
      .then(data => { if (data.facebook_page_url) setPageUrl(data.facebook_page_url); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true); setSaved(false);
    try {
      await apiFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facebook_page_url: pageUrl }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {}
    finally { setSaving(false); }
  }

  return (
    <div className="card">
      <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', marginBottom: 8 }}>
        URL de la Page Facebook
      </p>
      <p style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 16 }}>
        Ce lien s'ouvre quand tu cliques sur "Ouvrir ma Page Facebook" lors de la publication.
        Utilise l'URL directe de ta Page (ex : https://www.facebook.com/MonStudio).
      </p>

      {loading ? (
        <div className="spinner" style={{ margin: '16px auto' }} />
      ) : (
        <>
          <input
            type="url"
            className="input"
            placeholder="https://www.facebook.com/MaPage"
            value={pageUrl}
            onChange={e => { setPageUrl(e.target.value); setSaved(false); }}
            style={{ width: '100%', marginBottom: 12 }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving || !pageUrl.trim()}>
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
            {pageUrl && (
              <a href={pageUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: 'var(--accent)' }}>
                Tester le lien ↗
              </a>
            )}
            {saved && <span style={{ fontSize: 12, color: 'var(--success)' }}>✓ Enregistré</span>}
          </div>
        </>
      )}
    </div>
  );
}
