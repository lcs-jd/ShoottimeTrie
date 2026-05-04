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
    if (!ok) setError(err || 'Mot de passe incorrect.');
    setLoading(false);
  }

  return (
    <div className="login-wrap">
      <div className="login-box fadein">
        <div className="login-logo">
          <div className="login-logo-icon">S</div>
          <div className="login-title">ShoottimeTrie</div>
          <div className="login-sub">Connexion requise</div>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <label className="label">Mot de passe</label>
          <input
            type="password"
            className="input"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••••"
            autoFocus
            autoComplete="current-password"
          />

          {error && (
            <div className="alert alert-error" style={{ marginTop: 12 }}>
              <span>✕</span> {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading || !password}
            style={{ width: '100%', marginTop: 16, padding: '10px' }}
          >
            {loading && <div className="spinner spinner-dark spinner-sm" />}
            {loading ? 'Vérification…' : 'Se connecter'}
          </button>
        </form>
      </div>
    </div>
  );
}
