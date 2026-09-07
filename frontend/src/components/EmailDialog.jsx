import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { apiFetch } from '../lib/api.js';

const VERSIONS = [
  { key: 'watermarked', label: 'Filigranée',   hint: 'Filigranée à la volée si besoin' },
  { key: 'original',    label: 'Original',     hint: 'Pleine qualité, sans filigrane'  },
  { key: 'both',        label: 'Les deux',     hint: 'Filigranée + original'           },
];

export default function EmailDialog({ photos, onClose, onSent }) {
  const [contacts, setContacts]   = useState([]);
  const [query, setQuery]         = useState('');
  const [selected, setSelected]   = useState([]);
  const [version, setVersion]     = useState('watermarked');
  const [subject, setSubject]     = useState('');
  const [message, setMessage]     = useState('');
  const [sending, setSending]     = useState(false);
  const [error, setError]         = useState(null);
  const [configured, setConfigured] = useState(null);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    apiFetch('/api/email/config').then(r => r.json())
      .then(cfg => setConfigured(cfg.configured))
      .catch(() => setConfigured(false));
  }, []);

  // Autocomplétion : carnet Zimbra + annuaire global, avec anti-rebond
  useEffect(() => {
    if (configured === false) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setLoadingContacts(true);
      apiFetch(`/api/email/contacts?q=${encodeURIComponent(query)}`)
        .then(r => r.ok ? r.json() : [])
        .then(list => setContacts(Array.isArray(list) ? list : []))
        .catch(() => setContacts([]))
        .finally(() => setLoadingContacts(false));
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, configured]);

  function addRecipient(email, name) {
    const addr = String(email).trim().toLowerCase();
    if (!addr || selected.some(s => s.email === addr)) return;
    setSelected(prev => [...prev, { email: addr, name: name || addr }]);
    setQuery('');
  }

  function addTyped() {
    const v = query.trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) addRecipient(v);
  }

  async function send() {
    if (selected.length === 0) return setError('Choisis au moins un destinataire.');
    setSending(true);
    setError(null);
    try {
      const res = await apiFetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: selected.map(s => s.email),
          photoIds: photos.map(p => p.id),
          version, subject, message,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Envoi échoué');
      onSent?.(data);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  const suggestions = contacts.filter(c => !selected.some(s => s.email === c.email)).slice(0, 8);

  const dialog = (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      onClick={onClose}
    >
      <div
        className="card"
        style={{ width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto', margin: 0 }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>
            Envoyer {photos.length > 1 ? `${photos.length} photos` : 'la photo'} par email
          </h2>
          <button onClick={onClose} className="btn btn-ghost btn-sm">✕</button>
        </div>

        {configured === false && (
          <div style={{ padding: 12, borderRadius: 8, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', color: 'var(--accent)', fontSize: 13, marginBottom: 12 }}>
            Compte Zimbra non configuré. Renseigne-le dans <strong>Réglages → Email</strong> pour activer l'envoi et l'autocomplétion des contacts.
          </div>
        )}

        {/* Destinataires sélectionnés */}
        {selected.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {selected.map(s => (
              <span key={s.email} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 6, background: 'var(--surface2)', border: '1px solid var(--border2)', fontSize: 12, color: 'var(--text)' }}>
                {s.name !== s.email ? `${s.name} <${s.email}>` : s.email}
                <button
                  onClick={() => setSelected(prev => prev.filter(x => x.email !== s.email))}
                  style={{ background: 'none', border: 'none', color: 'var(--dim)', cursor: 'pointer', padding: 0, fontSize: 13 }}
                >✕</button>
              </span>
            ))}
          </div>
        )}

        <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 5 }}>Destinataires</label>
        <input
          className="input"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTyped(); } }}
          placeholder="Nom ou adresse email…"
          style={{ width: '100%' }}
        />

        {/* Suggestions */}
        {(suggestions.length > 0 || loadingContacts) && (
          <div style={{ marginTop: 6, border: '1px solid var(--border2)', borderRadius: 8, overflow: 'hidden', maxHeight: 180, overflowY: 'auto' }}>
            {loadingContacts && suggestions.length === 0 && (
              <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--dim)' }}>Recherche…</div>
            )}
            {suggestions.map(c => (
              <button
                key={c.email}
                onClick={() => addRecipient(c.email, c.name)}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: 12, color: 'var(--text)', fontFamily: 'inherit' }}
              >
                <div>{c.name}</div>
                <div style={{ color: 'var(--dim)', fontSize: 11 }}>{c.email}</div>
              </button>
            ))}
          </div>
        )}

        {/* Version */}
        <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', margin: '14px 0 5px' }}>Version envoyée</label>
        <div style={{ display: 'flex', gap: 6 }}>
          {VERSIONS.map(v => (
            <button
              key={v.key}
              onClick={() => setVersion(v.key)}
              title={v.hint}
              style={{
                flex: 1, padding: '8px 4px', borderRadius: 7, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
                background: version === v.key ? 'rgba(245,158,11,0.12)' : 'var(--surface2)',
                color: version === v.key ? 'var(--accent)' : 'var(--muted)',
                border: `1px solid ${version === v.key ? 'rgba(245,158,11,0.45)' : 'var(--border2)'}`,
              }}
            >{v.label}</button>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 5 }}>
          {VERSIONS.find(v => v.key === version).hint}
          {version !== 'original' && ' — le statut de la photo dans l\'app reste inchangé.'}
        </div>

        {/* Sujet / message */}
        <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', margin: '14px 0 5px' }}>Sujet</label>
        <input
          className="input"
          value={subject}
          onChange={e => setSubject(e.target.value)}
          placeholder={`Vos photos (${photos.length})`}
          style={{ width: '100%' }}
        />

        <label style={{ display: 'block', fontSize: 12, color: 'var(--muted)', margin: '12px 0 5px' }}>Message</label>
        <textarea
          className="input"
          value={message}
          onChange={e => setMessage(e.target.value)}
          rows={3}
          placeholder="Bonjour, veuillez trouver ci-joint vos photos…"
          style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
        />

        {error && (
          <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: 'var(--danger)', fontSize: 12 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={onClose} style={{ flex: 1 }} disabled={sending}>Annuler</button>
          <button
            className="btn btn-primary"
            onClick={send}
            disabled={sending || selected.length === 0 || configured === false}
            style={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            {sending ? <><div className="spinner spinner-sm spinner-dark" /> Envoi…</> : `Envoyer${selected.length ? ` à ${selected.length}` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}
