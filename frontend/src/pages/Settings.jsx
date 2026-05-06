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
const POSITIONS = [
  { id: 'northwest', label: '↖' }, { id: 'north',  label: '↑' }, { id: 'northeast', label: '↗' },
  { id: 'west',     label: '←' }, { id: 'center', label: '·' }, { id: 'east',      label: '→' },
  { id: 'southwest', label: '↙' }, { id: 'south', label: '↓' }, { id: 'southeast', label: '↘' },
];

function WatermarkTab() {
  // Logo
  const [logoPreview, setLogoPreview] = useState(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoDragOver, setLogoDragOver] = useState(false);
  const logoInputRef = useRef();

  // Photo de prévisualisation
  const [hasPreviewPhoto, setHasPreviewPhoto] = useState(false);
  const [photoDragOver, setPhotoDragOver] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const photoInputRef = useRef();

  // Paramètres
  const [position, setPosition] = useState('southeast');
  const [size, setSize] = useState(15);
  const [opacity, setOpacity] = useState(100);
  const [margin, setMargin] = useState(2);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState(null);

  // Aperçu composite
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState(null);

  const [message, setMessage] = useState(null);

  useEffect(() => {
    apiFetch('/api/watermark').then(r => {
      if (r.ok) setLogoPreview('/api/watermark?' + Date.now());
    }).catch(() => {});

    apiFetch('/api/watermark/preview-photo').then(r => {
      if (r.ok) setHasPreviewPhoto(true);
    }).catch(() => {});

    apiFetch('/api/settings').then(r => r.json()).then(data => {
      if (data.watermark_position) setPosition(data.watermark_position);
      if (data.watermark_size)     setSize(parseFloat(data.watermark_size));
      if (data.watermark_opacity)  setOpacity(parseFloat(data.watermark_opacity));
      if (data.watermark_margin)   setMargin(parseFloat(data.watermark_margin));
    }).catch(() => {}).finally(() => setSettingsLoading(false));
  }, []);

  // Upload logo
  async function handleLogoFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setMessage({ type: 'error', text: 'Sélectionnez une image (PNG recommandé).' }); return; }
    setLogoUploading(true); setMessage(null);
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await apiFetch('/api/watermark', { method: 'POST', body: form });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Erreur serveur'); }
      setLogoPreview('/api/watermark?' + Date.now());
      setPreviewUrl(null);
      setMessage({ type: 'success', text: 'Logo mis à jour.' });
    } catch (err) { setMessage({ type: 'error', text: err.message }); }
    finally { setLogoUploading(false); }
  }

  // Upload photo de prévisualisation
  async function handlePhotoFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setMessage({ type: 'error', text: 'Sélectionnez une image.' }); return; }
    setPhotoUploading(true); setMessage(null);
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await apiFetch('/api/watermark/preview-photo', { method: 'POST', body: form });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'Erreur serveur'); }
      setHasPreviewPhoto(true);
      setPreviewUrl(null);
      setMessage({ type: 'success', text: 'Photo de prévisualisation mise à jour.' });
    } catch (err) { setMessage({ type: 'error', text: err.message }); }
    finally { setPhotoUploading(false); }
  }

  async function saveSettings() {
    setSaving(true); setSaveMsg(null);
    try {
      await apiFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          watermark_position: position,
          watermark_size: String(size),
          watermark_opacity: String(opacity),
          watermark_margin: String(margin),
        }),
      });
      setSaveMsg({ type: 'success', text: 'Paramètres enregistrés.' });
      setTimeout(() => setSaveMsg(null), 3000);
    } catch { setSaveMsg({ type: 'error', text: 'Erreur lors de la sauvegarde.' }); }
    finally { setSaving(false); }
  }

  async function generatePreview() {
    if (!hasPreviewPhoto || !logoPreview) return;
    setPreviewing(true); setPreviewError(null);
    try {
      await saveSettings();
      setPreviewUrl('/api/watermark/preview?' + Date.now());
    } catch {
      setPreviewError('Impossible de générer l\'aperçu.');
    } finally { setPreviewing(false); }
  }

  return (
    <>
      {/* ── Logo du filigrane ── */}
      <div className="card" style={{ marginBottom: 12 }}>
        <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', marginBottom: 8 }}>
          Logo filigrane
        </p>
        <p style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 14 }}>PNG avec transparence recommandé — 5 Mo max</p>

        {logoPreview && (
          <div style={{
            background: 'repeating-conic-gradient(#222 0% 25%, #1a1a1a 0% 50%) 0 0 / 16px 16px',
            borderRadius: 8, padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 12, minHeight: 80,
          }}>
            <img src={logoPreview} alt="Logo filigrane" style={{ maxWidth: '100%', maxHeight: 100, objectFit: 'contain' }} />
          </div>
        )}

        <div
          className={`dropzone${logoDragOver ? ' drag-over' : ''}`}
          style={{ minHeight: 80 }}
          onClick={() => logoInputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setLogoDragOver(true); }}
          onDragLeave={() => setLogoDragOver(false)}
          onDrop={e => { e.preventDefault(); setLogoDragOver(false); handleLogoFile(e.dataTransfer.files[0]); }}
        >
          {logoUploading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <div className="spinner" /><p style={{ fontSize: 13, color: 'var(--muted)' }}>Upload…</p>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 22, color: 'var(--dim)', marginBottom: 6 }}>↑</div>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>{logoPreview ? 'Remplacer le logo' : 'Glissez votre logo ici'}</p>
              <button type="button" className="btn btn-primary btn-sm" onClick={e => { e.stopPropagation(); logoInputRef.current?.click(); }}>
                Choisir un fichier
              </button>
            </>
          )}
          <input ref={logoInputRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={e => { handleLogoFile(e.target.files[0]); e.target.value = ''; }} />
        </div>
      </div>

      {/* ── Paramètres ── */}
      <div className="card" style={{ marginBottom: 12 }}>
        <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', marginBottom: 16 }}>
          Paramètres du filigrane
        </p>

        {settingsLoading ? <div className="spinner" style={{ margin: '16px auto' }} /> : (
          <>
            {/* Position */}
            <div style={{ marginBottom: 20 }}>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>Position</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, maxWidth: 180 }}>
                {POSITIONS.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPosition(p.id)}
                    style={{
                      padding: '10px 0', fontSize: 16, borderRadius: 6, border: '1px solid',
                      borderColor: position === p.id ? 'var(--accent)' : 'var(--border)',
                      background: position === p.id ? 'rgba(245,158,11,0.12)' : 'var(--surface2)',
                      color: position === p.id ? 'var(--accent)' : 'var(--muted)',
                      cursor: 'pointer', transition: 'all .15s',
                    }}
                  >{p.label}</button>
                ))}
              </div>
            </div>

            {/* Taille */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <p style={{ fontSize: 12, color: 'var(--muted)' }}>Taille</p>
                <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{size}% de la largeur</p>
              </div>
              <input type="range" min={3} max={50} step={1} value={size}
                onChange={e => setSize(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--accent)' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--dim)' }}>3%</span>
                <span style={{ fontSize: 11, color: 'var(--dim)' }}>50%</span>
              </div>
            </div>

            {/* Opacité */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <p style={{ fontSize: 12, color: 'var(--muted)' }}>Opacité</p>
                <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{opacity}%</p>
              </div>
              <input type="range" min={10} max={100} step={5} value={opacity}
                onChange={e => setOpacity(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--accent)' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--dim)' }}>10%</span>
                <span style={{ fontSize: 11, color: 'var(--dim)' }}>100%</span>
              </div>
            </div>

            {/* Marge */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <p style={{ fontSize: 12, color: 'var(--muted)' }}>Marge</p>
                <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{margin}% de la largeur</p>
              </div>
              <input type="range" min={0} max={10} step={0.5} value={margin}
                onChange={e => setMargin(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--accent)' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--dim)' }}>0% (collé)</span>
                <span style={{ fontSize: 11, color: 'var(--dim)' }}>10%</span>
              </div>
            </div>

            <button className="btn btn-primary btn-sm" onClick={saveSettings} disabled={saving}>
              {saving ? 'Enregistrement…' : 'Enregistrer les paramètres'}
            </button>
            {saveMsg && (
              <span style={{ marginLeft: 12, fontSize: 12, color: saveMsg.type === 'success' ? 'var(--success)' : 'var(--danger)' }}>
                {saveMsg.type === 'success' ? '✓' : '✕'} {saveMsg.text}
              </span>
            )}
          </>
        )}
      </div>

      {/* ── Prévisualisation ── */}
      <div className="card" style={{ marginBottom: 12 }}>
        <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--muted)', marginBottom: 8 }}>
          Prévisualisation
        </p>
        <p style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 14 }}>
          Importez une photo test (persistée, remplacez-la seulement si besoin). L'aperçu applique les paramètres actuels.
        </p>

        {/* Upload photo de test */}
        <div
          className={`dropzone${photoDragOver ? ' drag-over' : ''}`}
          style={{ minHeight: 70, marginBottom: 14 }}
          onClick={() => photoInputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setPhotoDragOver(true); }}
          onDragLeave={() => setPhotoDragOver(false)}
          onDrop={e => { e.preventDefault(); setPhotoDragOver(false); handlePhotoFile(e.dataTransfer.files[0]); }}
        >
          {photoUploading ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <div className="spinner" /><p style={{ fontSize: 13, color: 'var(--muted)' }}>Upload…</p>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 20, color: 'var(--dim)', marginBottom: 4 }}>
                {hasPreviewPhoto ? '✓' : '↑'}
              </div>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
                {hasPreviewPhoto ? 'Photo test chargée — cliquer pour remplacer' : 'Glissez une photo test ici'}
              </p>
              <button type="button" className="btn btn-sm" style={{ border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)' }}
                onClick={e => { e.stopPropagation(); photoInputRef.current?.click(); }}>
                {hasPreviewPhoto ? 'Remplacer' : 'Choisir une photo'}
              </button>
            </>
          )}
          <input ref={photoInputRef} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={e => { handlePhotoFile(e.target.files[0]); e.target.value = ''; }} />
        </div>

        {/* Bouton aperçu */}
        <button
          className="btn btn-primary btn-sm"
          onClick={generatePreview}
          disabled={previewing || !hasPreviewPhoto || !logoPreview}
          style={{ marginBottom: 14 }}
        >
          {previewing ? 'Génération…' : 'Actualiser l\'aperçu'}
        </button>
        {(!hasPreviewPhoto || !logoPreview) && (
          <p style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 10 }}>
            {!logoPreview ? '→ Importez d\'abord un logo.' : '→ Importez d\'abord une photo test.'}
          </p>
        )}
        {previewError && <p style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 10 }}>{previewError}</p>}

        {previewUrl && (
          <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
            <img src={previewUrl} alt="Aperçu filigrane" style={{ width: '100%', display: 'block' }} />
          </div>
        )}
        {!previewUrl && hasPreviewPhoto && logoPreview && (
          <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--dim)', border: '1px dashed var(--border)', borderRadius: 8 }}>
            <p style={{ fontSize: 13 }}>Cliquez "Actualiser l'aperçu" pour voir le résultat</p>
          </div>
        )}
      </div>

      {message && (
        <div className={`alert ${message.type === 'error' ? 'alert-error' : 'alert-success'}`} style={{ marginTop: 4 }}>
          <span>{message.type === 'error' ? '✕' : '✓'}</span> {message.text}
        </div>
      )}
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
