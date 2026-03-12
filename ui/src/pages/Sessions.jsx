import React, { useEffect, useState } from "react";
import { useAuthStore } from "../stores/authStore";

const API_BASE = import.meta.env.PROD ? "https://connect.chitty.cc" : "";

export default function Sessions() {
  const { user, getAuthHeaders } = useAuthStore();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user?.userId) {
      setLoading(false);
      return;
    }

    const headers = {
      ...getAuthHeaders(),
      "X-ChittyID": user.userId,
    };

    fetch(`${API_BASE}/api/v1/sessions`, { headers })
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setSessions(data.data?.sessions || data.data || []);
        } else {
          setError(data.error);
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [user?.userId, getAuthHeaders]);

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">Sessions</h1>
        <p className="page-subtitle">Active sessions for your identity</p>
      </div>

      <div className="page-content">
        {loading ? (
          <div className="loading-container">
            <div className="loading-spinner" />
          </div>
        ) : error ? (
          <div className="empty-state">
            <div className="empty-state-title">Error</div>
            <div className="empty-state-message">{error}</div>
          </div>
        ) : !user?.userId ? (
          <div className="empty-state">
            <div className="empty-state-title">No ChittyID</div>
            <div className="empty-state-message">
              Your API key does not have an associated ChittyID identity. Sessions require a ChittyID.
            </div>
          </div>
        ) : sessions.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">No Active Sessions</div>
            <div className="empty-state-message">
              No sessions found for {user.userId}.
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Session ID</th>
                    <th>Status</th>
                    <th>Bound At</th>
                    <th>Context</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.session_id || s.id}>
                      <td style={{ fontFamily: "'SF Mono', Consolas, monospace", fontSize: 12 }}>
                        {s.session_id || s.id}
                      </td>
                      <td>
                        <span className={`status-badge ${s.status || "active"}`}>
                          {s.status || "active"}
                        </span>
                      </td>
                      <td style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                        {s.bound_at || s.created_at
                          ? new Date(s.bound_at || s.created_at).toLocaleString()
                          : "N/A"}
                      </td>
                      <td style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                        {s.context_type || s.context || "N/A"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
