import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import AdminUpload from './pages/AdminUpload.jsx';
import SortingGallery from './pages/SortingGallery.jsx';
import AdminDashboard from './pages/AdminDashboard.jsx';
import Home from './pages/Home.jsx';
import WatermarkSettings from './pages/WatermarkSettings.jsx';
import Login from './pages/Login.jsx';

function AppShell() {
  const { authenticated, logout } = useAuth();

  if (authenticated === null) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: 'var(--text-muted)' }}>Chargement...</span>
      </div>
    );
  }

  if (!authenticated) return <Login />;

  return (
    <>
      <nav>
        <span className="logo">ShoottimeTrie</span>
        <div className="nav-links">
          <NavLink to="/">Sessions</NavLink>
          <NavLink to="/upload">Upload</NavLink>
          <NavLink to="/watermark">Filigrane</NavLink>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 13, padding: '6px 12px' }}
            onClick={logout}
          >
            Déconnexion
          </button>
        </div>
      </nav>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/upload" element={<AdminUpload />} />
        <Route path="/sort/:sessionId" element={<SortingGallery />} />
        <Route path="/dashboard/:sessionId" element={<AdminDashboard />} />
        <Route path="/watermark" element={<WatermarkSettings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AppShell />
      </BrowserRouter>
    </AuthProvider>
  );
}
