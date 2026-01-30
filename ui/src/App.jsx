import React from 'react';
import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { useDashboardStore } from './stores/dashboardStore';

// Pages
import Overview from './pages/Overview';
import Contexts from './pages/Contexts';
import ContextDetail from './pages/ContextDetail';
import Approvals from './pages/Approvals';
import Teams from './pages/Teams';

// Icons
const Icons = {
  Dashboard: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  Contexts: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  ),
  Approvals: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 12l2 2 4-4" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  ),
  Teams: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="8" cy="8" r="3" />
      <circle cx="16" cy="8" r="3" />
      <circle cx="12" cy="16" r="3" />
      <path d="M8 11v2" />
      <path d="M16 11v2" />
      <path d="M10 15l2-2 2 2" />
    </svg>
  ),
  Settings: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
    </svg>
  ),
};

function Sidebar() {
  const { stats, fetchStats } = useDashboardStore();
  const location = useLocation();

  React.useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">ChittyID</div>
        <div className="sidebar-subtitle">Context Dashboard</div>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-section">
          <div className="nav-section-title">Overview</div>
          <NavLink
            to="/"
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <span className="nav-item-icon"><Icons.Dashboard /></span>
            Dashboard
          </NavLink>
        </div>

        <div className="nav-section">
          <div className="nav-section-title">Entities</div>
          <NavLink
            to="/contexts"
            className={({ isActive }) => `nav-item ${isActive || location.pathname.startsWith('/contexts') ? 'active' : ''}`}
          >
            <span className="nav-item-icon"><Icons.Contexts /></span>
            Contexts
            {stats?.overview?.active_contexts > 0 && (
              <span className="nav-badge" style={{ background: 'var(--accent-info)' }}>
                {stats.overview.active_contexts}
              </span>
            )}
          </NavLink>
        </div>

        <div className="nav-section">
          <div className="nav-section-title">Workflows</div>
          <NavLink
            to="/approvals"
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <span className="nav-item-icon"><Icons.Approvals /></span>
            Approvals
            {stats?.overview?.pending_approvals > 0 && (
              <span className="nav-badge">
                {stats.overview.pending_approvals}
              </span>
            )}
          </NavLink>
          <NavLink
            to="/teams"
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <span className="nav-item-icon"><Icons.Teams /></span>
            Team Builder
          </NavLink>
        </div>
      </nav>

      <div style={{ padding: '16px', borderTop: '1px solid var(--border-primary)' }}>
        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
          Connected to
        </div>
        <div style={{ fontSize: '12px', color: 'var(--accent-success)', marginTop: '4px' }}>
          connect.chitty.cc
        </div>
      </div>
    </aside>
  );
}

export default function App() {
  return (
    <div className="app-container">
      <Sidebar />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/contexts" element={<Contexts />} />
          <Route path="/contexts/:id" element={<ContextDetail />} />
          <Route path="/approvals" element={<Approvals />} />
          <Route path="/teams" element={<Teams />} />
        </Routes>
      </main>
    </div>
  );
}
