import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useDashboardStore } from "../stores/dashboardStore";

const CATEGORIES = [
  { value: null, label: "All" },
  { value: "chittyos_service", label: "ChittyOS" },
  { value: "thirdparty", label: "Third-Party" },
  { value: "database", label: "Database" },
  { value: "ai_provider", label: "AI" },
];

const STATUSES = [
  { value: "active", label: "Active" },
  { value: null, label: "All" },
  { value: "inactive", label: "Inactive" },
];

const CATEGORY_COLORS = {
  chittyos_service: "#6366f1",
  thirdparty: "#06b6d4",
  database: "#f59e0b",
  ai_provider: "#ec4899",
};

const HEALTH_COLORS = {
  healthy: "var(--accent-success)",
  degraded: "var(--accent-warning)",
  down: "var(--accent-danger)",
  unknown: "var(--text-muted)",
};

export default function Connections() {
  const {
    connections,
    connectionFilters,
    connectionStats,
    setConnectionFilters,
    fetchConnections,
    fetchConnectionStats,
    testConnection,
    testAllConnections,
    connectionsLoading,
  } = useDashboardStore();

  const [testingSlug, setTestingSlug] = useState(null);
  const [testingAll, setTestingAll] = useState(false);

  useEffect(() => {
    fetchConnections();
    fetchConnectionStats();
  }, [connectionFilters, fetchConnections, fetchConnectionStats]);

  const handleTestAll = async () => {
    setTestingAll(true);
    await testAllConnections();
    await Promise.all([fetchConnections(), fetchConnectionStats()]);
    setTestingAll(false);
  };

  const handleTest = async (e, slug) => {
    e.preventDefault();
    e.stopPropagation();
    setTestingSlug(slug);
    await testConnection(slug);
    await fetchConnections();
    setTestingSlug(null);
  };

  const stats = connectionStats || {};

  return (
    <>
      <header
        className="page-header"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <h1 className="page-title">Connections</h1>
          <p className="page-subtitle">
            Manage ChittyOS services and third-party integrations
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <Link
            to="/connections/graph"
            className="btn btn-secondary btn-sm"
            style={{ textDecoration: "none" }}
          >
            View Graph
          </Link>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleTestAll}
            disabled={testingAll}
          >
            {testingAll ? "Testing..." : "Test All"}
          </button>
        </div>
      </header>

      <div className="page-content">
        {/* Stats Row */}
        <div
          className="stats-grid"
          style={{ gridTemplateColumns: "repeat(4, 1fr)" }}
        >
          <div className="stat-card">
            <div className="stat-label">Total</div>
            <div className="stat-value">{stats.total || 0}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Healthy</div>
            <div
              className="stat-value"
              style={{ color: "var(--accent-success)" }}
            >
              {stats.healthy || 0}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Degraded</div>
            <div
              className="stat-value"
              style={{ color: "var(--accent-warning)" }}
            >
              {stats.degraded || 0}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Down / Unknown</div>
            <div
              className="stat-value"
              style={{ color: "var(--accent-danger)" }}
            >
              {(stats.down || 0) + (stats.unknown || 0)}
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="filters-bar">
          <span
            style={{
              fontSize: "13px",
              color: "var(--text-muted)",
              marginRight: "8px",
            }}
          >
            Category:
          </span>
          {CATEGORIES.map((cat) => (
            <button
              key={cat.label}
              className={`filter-chip ${connectionFilters.category === cat.value ? "active" : ""}`}
              onClick={() => setConnectionFilters({ category: cat.value })}
            >
              {cat.label}
            </button>
          ))}

          <span
            style={{
              fontSize: "13px",
              color: "var(--text-muted)",
              marginLeft: "16px",
              marginRight: "8px",
            }}
          >
            Status:
          </span>
          {STATUSES.map((st) => (
            <button
              key={st.label}
              className={`filter-chip ${connectionFilters.status === st.value ? "active" : ""}`}
              onClick={() => setConnectionFilters({ status: st.value })}
            >
              {st.label}
            </button>
          ))}
        </div>

        {/* Connection Cards */}
        {connectionsLoading ? (
          <div className="loading-container">
            <div className="loading-spinner" />
          </div>
        ) : connections.length > 0 ? (
          <div className="entity-grid">
            {connections.map((conn) => (
              <Link
                key={conn.id}
                to={`/connections/${conn.slug}`}
                className="connection-card"
                style={{ textDecoration: "none" }}
              >
                <div className="connection-card-header">
                  <div
                    className="connection-icon"
                    style={{
                      background: `linear-gradient(135deg, ${CATEGORY_COLORS[conn.category] || "#6366f1"}, ${CATEGORY_COLORS[conn.category] || "#6366f1"}88)`,
                    }}
                  >
                    {conn.icon || conn.name?.charAt(0)}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div className="connection-name">{conn.name}</div>
                    <div className="connection-url">
                      {conn.base_url || "No URL"}
                    </div>
                  </div>
                  <div
                    className="connection-status-dot"
                    style={{
                      background:
                        HEALTH_COLORS[conn.last_health_status] ||
                        HEALTH_COLORS.unknown,
                    }}
                    title={conn.last_health_status || "unknown"}
                  />
                </div>

                <div className="connection-description">{conn.description}</div>

                <div className="connection-card-footer">
                  <span
                    className="category-badge"
                    style={{
                      borderColor: CATEGORY_COLORS[conn.category] || "#6366f1",
                      color: CATEGORY_COLORS[conn.category] || "#6366f1",
                    }}
                  >
                    {conn.category === "chittyos_service"
                      ? `Tier ${conn.tier}`
                      : conn.category?.replace("_", " ")}
                  </span>
                  {conn.last_health_latency_ms != null && (
                    <span className="connection-latency">
                      {conn.last_health_latency_ms}ms
                    </span>
                  )}
                  <button
                    className="btn btn-secondary btn-sm connection-test-btn"
                    onClick={(e) => handleTest(e, conn.slug)}
                    disabled={testingSlug === conn.slug}
                  >
                    {testingSlug === conn.slug ? "..." : "Test"}
                  </button>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-state-title">No connections found</div>
            <div className="empty-state-message">
              {connectionFilters.category || connectionFilters.status
                ? "Try adjusting your filters"
                : "Run the migration to seed connection data"}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
