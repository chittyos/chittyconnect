import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";

const API_BASE = import.meta.env.PROD ? "https://connect.chitty.cc" : "";

// Simple ChittyID format detection: VV-G-LLL-SSSS-T-YM-C-X
const CHITTYID_RE = /^\d{2}-\d-[A-Z]{3}-\d{4}-[PLTEA]-\d{4}-\d-\d+$/;

export default function Profile() {
  const { user, fetchProfile, getAuthHeaders } = useAuthStore();
  const [parsedId, setParsedId] = useState(null);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  useEffect(() => {
    if (user?.userId && CHITTYID_RE.test(user.userId)) {
      fetch(`${API_BASE}/api/chittyid/parse/${user.userId}`, {
        headers: getAuthHeaders(),
      })
        .then((r) => r.json())
        .then((d) => {
          if (d.success || d.data) setParsedId(d.data || d);
        })
        .catch(() => {});
    }
  }, [user?.userId, getAuthHeaders]);

  if (!user) {
    return (
      <div className="loading-container">
        <div className="loading-spinner" />
      </div>
    );
  }

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Profile</h1>
        <p className="page-subtitle">Your identity and key information</p>
      </div>

      <div className="page-content">
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-label">User ID</div>
            <div className="stat-value" style={{ fontSize: 16, fontFamily: "'SF Mono', Consolas, monospace" }}>
              {user.userId || "N/A"}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Key Name</div>
            <div className="stat-value" style={{ fontSize: 18 }}>
              {user.name || "Unnamed"}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Auth Type</div>
            <div className="stat-value" style={{ fontSize: 18, textTransform: "capitalize" }}>
              {user.type || "api_key"}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Scopes</div>
            <div className="stat-value" style={{ fontSize: 24 }}>
              {user.scopes?.length || 0}
            </div>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 24 }}>
          <div className="card-header">
            <span className="card-title">Identity Details</span>
          </div>
          <div className="card-body">
            <div style={{ display: "grid", gap: 12 }}>
              <div>
                <div className="form-label">Scopes</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {(user.scopes || []).length > 0 ? (
                    user.scopes.map((s) => (
                      <span key={s} className="scope-badge">{s}</span>
                    ))
                  ) : (
                    <span style={{ color: "var(--text-muted)", fontSize: 14 }}>No scopes</span>
                  )}
                </div>
              </div>
              {user.rateLimit && (
                <div>
                  <div className="form-label">Rate Limit</div>
                  <div style={{ fontSize: 14, color: "var(--text-primary)" }}>
                    {user.rateLimit} requests/min
                  </div>
                </div>
              )}
              {user.metadata && Object.keys(user.metadata).length > 0 && (
                <div>
                  <div className="form-label">Metadata</div>
                  <pre style={{
                    fontSize: 12,
                    color: "var(--text-secondary)",
                    background: "var(--bg-tertiary)",
                    padding: 12,
                    borderRadius: 8,
                    overflow: "auto",
                  }}>
                    {JSON.stringify(user.metadata, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>

        {parsedId && (
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="card-header">
              <span className="card-title">ChittyID Components</span>
            </div>
            <div className="card-body">
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Component</th>
                      <th>Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(parsedId).map(([key, val]) => (
                      <tr key={key}>
                        <td style={{ textTransform: "capitalize" }}>{key.replace(/_/g, " ")}</td>
                        <td style={{ fontFamily: "'SF Mono', Consolas, monospace" }}>
                          {String(val)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 12 }}>
          <Link to="/api-keys" className="btn btn-secondary">
            Manage API Keys
          </Link>
          <Link to="/sessions" className="btn btn-secondary">
            View Sessions
          </Link>
        </div>
      </div>
    </>
  );
}
