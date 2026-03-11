import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useDashboardStore } from "../stores/dashboardStore";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const HEALTH_COLORS = {
  healthy: "var(--accent-success)",
  degraded: "var(--accent-warning)",
  down: "var(--accent-danger)",
  unknown: "var(--text-muted)",
};

export default function ConnectionDetail() {
  const { slug } = useParams();
  const {
    connectionDetail,
    connectionHealthHistory,
    connectionsLoading,
    fetchConnection,
    fetchConnectionHealthHistory,
    updateConnection,
    deleteConnection,
    testConnection,
    testConnectionCredential,
    clearConnectionDetail,
  } = useDashboardStore();

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [testResult, setTestResult] = useState(null);
  const [credResult, setCredResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    fetchConnection(slug);
    fetchConnectionHealthHistory(slug);
    return () => clearConnectionDetail();
  }, [
    slug,
    fetchConnection,
    fetchConnectionHealthHistory,
    clearConnectionDetail,
  ]);

  useEffect(() => {
    if (connectionDetail) {
      setForm({
        name: connectionDetail.name || "",
        base_url: connectionDetail.base_url || "",
        health_endpoint: connectionDetail.health_endpoint || "",
        api_version: connectionDetail.api_version || "",
        credential_source: connectionDetail.credential_source || "env",
        credential_path: connectionDetail.credential_path || "",
        credential_env_var: connectionDetail.credential_env_var || "",
        service_token_pattern: connectionDetail.service_token_pattern || "",
        description: connectionDetail.description || "",
        tags: (connectionDetail.tags || []).join(", "),
      });
    }
  }, [connectionDetail]);

  if (connectionsLoading && !connectionDetail) {
    return (
      <div className="loading-container">
        <div className="loading-spinner" />
      </div>
    );
  }

  if (!connectionDetail) {
    return (
      <div className="page-content">
        <div className="empty-state">
          <div className="empty-state-title">Connection not found</div>
          <Link
            to="/connections"
            className="btn btn-secondary"
            style={{ marginTop: "16px", textDecoration: "none" }}
          >
            Back to Connections
          </Link>
        </div>
      </div>
    );
  }

  const conn = connectionDetail;
  const healthColor =
    HEALTH_COLORS[conn.last_health_status] || HEALTH_COLORS.unknown;

  const handleSave = async () => {
    setSaving(true);
    try {
      const updates = { ...form };
      updates.tags = form.tags
        ? form.tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
        : [];
      await updateConnection(slug, updates);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testConnection(slug);
      setTestResult(
        result.success
          ? result.data
          : { status: "error", error: result.error },
      );
      await fetchConnection(slug);
      await fetchConnectionHealthHistory(slug);
    } finally {
      setTesting(false);
    }
  };

  const handleCredTest = async () => {
    setCredResult(null);
    const result = await testConnectionCredential(slug);
    setCredResult(
      result.success ? result.data : { available: false, source: "error" },
    );
  };

  const handleDelete = async () => {
    if (window.confirm(`Deactivate ${conn.name}?`)) {
      await deleteConnection(slug);
      window.location.href = "/connections";
    }
  };

  // Chart data from health history
  const chartData = [...connectionHealthHistory].reverse().map((entry) => ({
    time: new Date(entry.checked_at).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    }),
    latency: entry.latency_ms,
    status: entry.status,
  }));

  return (
    <>
      <header className="page-header">
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <Link
            to="/connections"
            style={{
              color: "var(--text-muted)",
              textDecoration: "none",
              fontSize: "14px",
            }}
          >
            Connections
          </Link>
          <span style={{ color: "var(--text-muted)" }}>/</span>
          <h1 className="page-title" style={{ margin: 0 }}>
            {conn.name}
          </h1>
          <div
            className="connection-status-dot"
            style={{ background: healthColor, width: "10px", height: "10px" }}
            title={conn.last_health_status || "unknown"}
          />
        </div>
        <p className="page-subtitle">{conn.description}</p>
      </header>

      <div className="page-content">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 300px",
            gap: "24px",
          }}
        >
          {/* Left: Form */}
          <div>
            <div className="card">
              <div className="card-header">
                <span className="card-title">Configuration</span>
                {!editing && (
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => setEditing(true)}
                  >
                    Edit
                  </button>
                )}
              </div>
              <div className="card-body">
                {editing ? (
                  <>
                    {[
                      { key: "name", label: "Name" },
                      { key: "base_url", label: "Base URL" },
                      { key: "health_endpoint", label: "Health Endpoint" },
                      { key: "api_version", label: "API Version" },
                      { key: "credential_path", label: "1Password Path" },
                      { key: "credential_env_var", label: "Env Variable" },
                      {
                        key: "service_token_pattern",
                        label: "Service Token Pattern",
                      },
                      { key: "description", label: "Description" },
                      { key: "tags", label: "Tags (comma-separated)" },
                    ].map(({ key, label }) => (
                      <div className="form-group" key={key}>
                        <label className="form-label">{label}</label>
                        <input
                          className="form-input"
                          value={form[key] || ""}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, [key]: e.target.value }))
                          }
                        />
                      </div>
                    ))}
                    <div className="form-group">
                      <label className="form-label">Credential Source</label>
                      <select
                        className="form-select"
                        value={form.credential_source}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            credential_source: e.target.value,
                          }))
                        }
                      >
                        <option value="env">Environment Variable</option>
                        <option value="onepassword">1Password</option>
                        <option value="oauth">OAuth</option>
                        <option value="none">None</option>
                      </select>
                    </div>
                    <div
                      style={{ display: "flex", gap: "8px", marginTop: "16px" }}
                    >
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={handleSave}
                        disabled={saving}
                      >
                        {saving ? "Saving..." : "Save Changes"}
                      </button>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => setEditing(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "16px",
                    }}
                  >
                    <DetailRow
                      label="Category"
                      value={conn.category?.replace("_", " ")}
                    />
                    <DetailRow label="Provider" value={conn.provider} />
                    <DetailRow label="Base URL" value={conn.base_url} mono />
                    <DetailRow
                      label="Health Endpoint"
                      value={conn.health_endpoint}
                      mono
                    />
                    <DetailRow label="API Version" value={conn.api_version} />
                    <DetailRow
                      label="Tier"
                      value={conn.tier != null ? `Tier ${conn.tier}` : "N/A"}
                    />
                    <DetailRow
                      label="Credential Source"
                      value={conn.credential_source}
                    />
                    <DetailRow
                      label="1Password Path"
                      value={conn.credential_path}
                      mono
                    />
                    <DetailRow
                      label="Env Variable"
                      value={conn.credential_env_var}
                      mono
                    />
                    <DetailRow
                      label="Token Pattern"
                      value={conn.service_token_pattern}
                      mono
                    />
                    <DetailRow label="Status" value={conn.status} />
                    <DetailRow label="Error Count" value={conn.error_count} />
                    <DetailRow
                      label="Consecutive Failures"
                      value={conn.consecutive_failures}
                    />
                    <DetailRow
                      label="Last Checked"
                      value={
                        conn.last_health_check
                          ? new Date(conn.last_health_check).toLocaleString()
                          : "Never"
                      }
                    />
                  </div>
                )}

                {conn.tags?.length > 0 && !editing && (
                  <div className="entity-tags" style={{ marginTop: "16px" }}>
                    {conn.tags.map((tag, i) => (
                      <span key={i} className="entity-tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Health Timeline Chart */}
            {chartData.length > 0 && (
              <div className="card" style={{ marginTop: "16px" }}>
                <div className="card-header">
                  <span className="card-title">Latency Timeline</span>
                </div>
                <div className="card-body">
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={chartData}>
                      <defs>
                        <linearGradient
                          id="latencyGradient"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="0%"
                            stopColor="#6366f1"
                            stopOpacity={0.3}
                          />
                          <stop
                            offset="100%"
                            stopColor="#6366f1"
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <XAxis
                        dataKey="time"
                        tick={{ fontSize: 11, fill: "var(--text-muted)" }}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: "var(--text-muted)" }}
                        unit="ms"
                      />
                      <Tooltip
                        contentStyle={{
                          background: "var(--bg-secondary)",
                          border: "1px solid var(--border-primary)",
                          borderRadius: "8px",
                        }}
                        labelStyle={{ color: "var(--text-primary)" }}
                      />
                      <Area
                        type="monotone"
                        dataKey="latency"
                        stroke="#6366f1"
                        fill="url(#latencyGradient)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Recent Health Log */}
            {connectionHealthHistory.length > 0 && (
              <div className="card" style={{ marginTop: "16px" }}>
                <div className="card-header">
                  <span className="card-title">Recent Health Checks</span>
                </div>
                <div className="card-body" style={{ padding: 0 }}>
                  <div className="table-container">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>Status</th>
                          <th>Latency</th>
                          <th>Code</th>
                          <th>Error</th>
                        </tr>
                      </thead>
                      <tbody>
                        {connectionHealthHistory.slice(0, 20).map((entry) => (
                          <tr key={entry.id}>
                            <td style={{ fontSize: "12px" }}>
                              {new Date(entry.checked_at).toLocaleString()}
                            </td>
                            <td>
                              <span
                                className="connection-status-dot"
                                style={{
                                  background:
                                    HEALTH_COLORS[entry.status] ||
                                    HEALTH_COLORS.unknown,
                                  display: "inline-block",
                                  marginRight: "6px",
                                }}
                              />
                              {entry.status}
                            </td>
                            <td className="connection-latency">
                              {entry.latency_ms != null
                                ? `${entry.latency_ms}ms`
                                : "-"}
                            </td>
                            <td>{entry.status_code || "-"}</td>
                            <td
                              style={{
                                fontSize: "12px",
                                color: "var(--text-muted)",
                                maxWidth: "200px",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {entry.error_message || "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right: Actions */}
          <div
            style={{ display: "flex", flexDirection: "column", gap: "12px" }}
          >
            <button
              className="btn btn-primary"
              onClick={handleTest}
              disabled={testing}
              style={{ width: "100%" }}
            >
              {testing ? "Testing..." : "Test Connection"}
            </button>
            {testResult && (
              <div
                style={{
                  padding: "12px",
                  borderRadius: "8px",
                  background:
                    testResult.status === "healthy"
                      ? "rgba(34, 197, 94, 0.1)"
                      : "rgba(239, 68, 68, 0.1)",
                  border: `1px solid ${HEALTH_COLORS[testResult.status] || HEALTH_COLORS.unknown}`,
                  fontSize: "13px",
                }}
              >
                <div
                  style={{
                    fontWeight: 600,
                    color:
                      HEALTH_COLORS[testResult.status] || HEALTH_COLORS.unknown,
                  }}
                >
                  {testResult.status?.toUpperCase()}
                </div>
                {testResult.latency_ms != null && (
                  <div>Latency: {testResult.latency_ms}ms</div>
                )}
                {testResult.status_code && (
                  <div>HTTP {testResult.status_code}</div>
                )}
                {testResult.error && (
                  <div
                    style={{ color: "var(--accent-danger)", marginTop: "4px" }}
                  >
                    {testResult.error}
                  </div>
                )}
              </div>
            )}

            <button
              className="btn btn-secondary"
              onClick={handleCredTest}
              style={{ width: "100%" }}
            >
              Test Credential
            </button>
            {credResult && (
              <div
                style={{
                  padding: "12px",
                  borderRadius: "8px",
                  background: credResult.available
                    ? "rgba(34, 197, 94, 0.1)"
                    : "rgba(239, 68, 68, 0.1)",
                  border: `1px solid ${credResult.available ? "var(--accent-success)" : "var(--accent-danger)"}`,
                  fontSize: "13px",
                }}
              >
                <div
                  style={{
                    fontWeight: 600,
                    color: credResult.available
                      ? "var(--accent-success)"
                      : "var(--accent-danger)",
                  }}
                >
                  {credResult.available ? "Available" : "Unavailable"}
                </div>
                <div>Source: {credResult.source}</div>
              </div>
            )}

            <div
              style={{
                borderTop: "1px solid var(--border-primary)",
                paddingTop: "12px",
                marginTop: "8px",
              }}
            >
              <div
                style={{
                  fontSize: "12px",
                  color: "var(--text-muted)",
                  marginBottom: "8px",
                }}
              >
                Info
              </div>
              <div
                style={{
                  fontSize: "13px",
                  color: "var(--text-secondary)",
                  lineHeight: 1.6,
                }}
              >
                <div>
                  Created:{" "}
                  {conn.created_at
                    ? new Date(conn.created_at).toLocaleDateString()
                    : "N/A"}
                </div>
                <div>
                  Updated:{" "}
                  {conn.updated_at
                    ? new Date(conn.updated_at).toLocaleDateString()
                    : "N/A"}
                </div>
                <div>
                  Last used:{" "}
                  {conn.last_used_at
                    ? new Date(conn.last_used_at).toLocaleString()
                    : "Never"}
                </div>
              </div>
            </div>

            {conn.depends_on?.length > 0 && (
              <div
                style={{
                  borderTop: "1px solid var(--border-primary)",
                  paddingTop: "12px",
                }}
              >
                <div
                  style={{
                    fontSize: "12px",
                    color: "var(--text-muted)",
                    marginBottom: "8px",
                  }}
                >
                  Dependencies
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {conn.depends_on.map((dep, i) => (
                    <span
                      key={i}
                      className="entity-tag"
                      style={{ fontSize: "12px" }}
                    >
                      {dep.replace("conn-", "")}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div style={{ marginTop: "auto", paddingTop: "16px" }}>
              <button
                className="btn btn-danger"
                onClick={handleDelete}
                style={{ width: "100%" }}
              >
                Deactivate Connection
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function DetailRow({ label, value, mono }) {
  return (
    <div>
      <div
        style={{
          fontSize: "11px",
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          marginBottom: "4px",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: "14px",
          color: value ? "var(--text-primary)" : "var(--text-muted)",
          fontFamily: mono ? "'SF Mono', Consolas, monospace" : "inherit",
          wordBreak: "break-all",
        }}
      >
        {value || "-"}
      </div>
    </div>
  );
}
