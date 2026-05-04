import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

export default function Login() {
  const { login } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const { ok, error: err } = await login(password);
    if (!ok) setError(err || 'Erreur de connexion.');
    setLoading(false);
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg)',
    }}>
      <form
        onSubmit={handleSubmit}
        className="card"
        style={{ width: '100%', maxWidth: 360 }}
      >
        <div style={{ marginBottom: 24, textAlign: 'center' }}>
          <span className="logo" style={{ fontSize: 22 }}>ShoottimeTrie</span>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 8 }}>
            Connexion requise
          </p>
        </div>

        <label style={{ display: 'block', marginBottom: 8, fontSize: 14, color: 'var(--text-muted)' }}>
          Mot de passe
        </label>
        <input
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="••••••••"
          autoFocus
          autoComplete="current-password"
        />

        {error && (
          <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 8 }}>{error}</p>
        )}

        <button
          type="submit"
          className="btn btn-primary"
          style={{ marginTop: 16, width: '100%' }}
          disabled={loading || !password}
        >
          {loading ? 'Connexion...' : 'Se connecter'}
        </button>
      </form>
    </div>
  );
}
