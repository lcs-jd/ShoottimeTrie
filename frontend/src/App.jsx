import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import AdminUpload from './pages/AdminUpload.jsx';
import SortingGallery from './pages/SortingGallery.jsx';
import AdminDashboard from './pages/AdminDashboard.jsx';
import Home from './pages/Home.jsx';
import Settings from './pages/Settings.jsx';
import Login from './pages/Login.jsx';
import PrivacyPolicy from './pages/PrivacyPolicy.jsx';

function AppShell() {
  const { authenticated, logout } = useAuth();

  if (authenticated === null) {
    return (
      <div className="loading-screen">
        <div className="loading-inner">
          <div className="spinner" />
          Chargement
        </div>
      </div>
    );
  }

  if (!authenticated) return <Login />;

  return (
    <div className="app-shell">
      <nav className="nav">
        <NavLink to="/" className="nav-logo">
          <div className="nav-logo-icon">S</div>
          <span className="nav-logo-text">ShoottimeTrie</span>
        </NavLink>

        <div className="nav-links">
          <NavLink to="/" end className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
            <span className="nav-link-icon">⊞</span>
            <span className="nav-link-label">Évènements</span>
          </NavLink>
          <NavLink to="/upload" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
            <span className="nav-link-icon">↑</span>
            <span className="nav-link-label">Upload</span>
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
            <span className="nav-link-icon">⚙</span>
            <span className="nav-link-label">Paramètres</span>
          </NavLink>
        </div>

        <button className="nav-logout" onClick={logout}>
          <span style={{ fontSize: 11 }}>⏻</span>
          <span className="nav-link-label">Quitter</span>
        </button>
      </nav>

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/upload" element={<AdminUpload />} />
        <Route path="/sort/:sessionId" element={<SortingGallery />} />
        <Route path="/dashboard/:sessionId" element={<AdminDashboard />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/watermark" element={<Navigate to="/settings" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <Routes>
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="*" element={<AppShell />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
