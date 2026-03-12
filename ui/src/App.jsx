import React from "react";
import { Routes, Route, NavLink, useLocation } from "react-router-dom";
import { useDashboardStore } from "./stores/dashboardStore";
import { useAuthStore } from "./stores/authStore";

// Pages
import Overview from "./pages/Overview";
import Contexts from "./pages/Contexts";
import ContextDetail from "./pages/ContextDetail";
import Approvals from "./pages/Approvals";
import Teams from "./pages/Teams";
import Connections from "./pages/Connections";
import ConnectionDetail from "./pages/ConnectionDetail";
import ConnectionGraph from "./pages/ConnectionGraph";
import Login from "./pages/Login";
import Profile from "./pages/Profile";
import ApiKeys from "./pages/ApiKeys";
import Sessions from "./pages/Sessions";
import OAuthCallback from "./pages/OAuthCallback";

// Components
import RequireAuth from "./components/RequireAuth";
import UserMenu from "./components/UserMenu";

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
  Connections: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="6" cy="6" r="3" />
      <circle cx="18" cy="18" r="3" />
      <path d="M8.5 8.5l7 7" />
      <circle cx="18" cy="6" r="3" />
      <path d="M8.5 6h7" />
    </svg>
  ),
  Key: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  ),
  User: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  Session: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
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
            className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
          >
            <span className="nav-item-icon">
              <Icons.Dashboard />
            </span>
            Dashboard
          </NavLink>
        </div>

        <div className="nav-section">
          <div className="nav-section-title">Entities</div>
          <NavLink
            to="/contexts"
            className={({ isActive }) =>
              `nav-item ${isActive || location.pathname.startsWith("/contexts") ? "active" : ""}`
            }
          >
            <span className="nav-item-icon">
              <Icons.Contexts />
            </span>
            Contexts
            {stats?.overview?.active_contexts > 0 && (
              <span
                className="nav-badge"
                style={{ background: "var(--accent-info)" }}
              >
                {stats.overview.active_contexts}
              </span>
            )}
          </NavLink>
        </div>

        <div className="nav-section">
          <div className="nav-section-title">Infrastructure</div>
          <NavLink
            to="/connections"
            className={({ isActive }) =>
              `nav-item ${isActive || location.pathname.startsWith("/connections") ? "active" : ""}`
            }
          >
            <span className="nav-item-icon">
              <Icons.Connections />
            </span>
            Connections
          </NavLink>
        </div>

        <div className="nav-section">
          <div className="nav-section-title">Workflows</div>
          <NavLink
            to="/approvals"
            className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
          >
            <span className="nav-item-icon">
              <Icons.Approvals />
            </span>
            Approvals
            {stats?.overview?.pending_approvals > 0 && (
              <span className="nav-badge">
                {stats.overview.pending_approvals}
              </span>
            )}
          </NavLink>
          <NavLink
            to="/teams"
            className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
          >
            <span className="nav-item-icon">
              <Icons.Teams />
            </span>
            Team Builder
          </NavLink>
        </div>

        <div className="nav-section">
          <div className="nav-section-title">Security</div>
          <NavLink
            to="/profile"
            className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
          >
            <span className="nav-item-icon">
              <Icons.User />
            </span>
            Profile
          </NavLink>
          <NavLink
            to="/api-keys"
            className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
          >
            <span className="nav-item-icon">
              <Icons.Key />
            </span>
            API Keys
          </NavLink>
          <NavLink
            to="/sessions"
            className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
          >
            <span className="nav-item-icon">
              <Icons.Session />
            </span>
            Sessions
          </NavLink>
        </div>
      </nav>

      <UserMenu />
    </aside>
  );
}

const NO_SIDEBAR_ROUTES = ["/login", "/oauth/callback"];

export default function App() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const location = useLocation();
  const showSidebar = isAuthenticated && !NO_SIDEBAR_ROUTES.includes(location.pathname);

  return (
    <div className={`app-container ${!showSidebar ? "app-container--no-sidebar" : ""}`}>
      {showSidebar && <Sidebar />}
      <main className={`main-content ${!showSidebar ? "main-content--full" : ""}`}>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/oauth/callback" element={<OAuthCallback />} />

          {/* Protected routes */}
          <Route path="/" element={<RequireAuth><Overview /></RequireAuth>} />
          <Route path="/contexts" element={<RequireAuth><Contexts /></RequireAuth>} />
          <Route path="/contexts/:id" element={<RequireAuth><ContextDetail /></RequireAuth>} />
          <Route path="/connections" element={<RequireAuth><Connections /></RequireAuth>} />
          <Route path="/connections/graph" element={<RequireAuth><ConnectionGraph /></RequireAuth>} />
          <Route path="/connections/:slug" element={<RequireAuth><ConnectionDetail /></RequireAuth>} />
          <Route path="/approvals" element={<RequireAuth><Approvals /></RequireAuth>} />
          <Route path="/teams" element={<RequireAuth><Teams /></RequireAuth>} />
          <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
          <Route path="/api-keys" element={<RequireAuth><ApiKeys /></RequireAuth>} />
          <Route path="/sessions" element={<RequireAuth><Sessions /></RequireAuth>} />
        </Routes>
      </main>
    </div>
  );
}
