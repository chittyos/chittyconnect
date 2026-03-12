import React, { useEffect, useState } from "react";
import { useAuthStore } from "../stores/authStore";

const AVAILABLE_SCOPES = ["mcp:read", "mcp:write"];

export default function ApiKeys() {
  const {
    apiKeys,
    apiKeysLoading,
    newKeyValue,
    fetchApiKeys,
    createApiKey,
    revokeApiKey,
    clearNewKeyValue,
  } = useAuthStore();

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState(["mcp:read", "mcp:write"]);
  const [expiresAt, setExpiresAt] = useState("");
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetchApiKeys();
  }, [fetchApiKeys]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreating(true);
    await createApiKey(name, scopes, expiresAt || null);
    setCreating(false);
    setShowCreate(false);
    setName("");
    setScopes(["mcp:read", "mcp:write"]);
    setExpiresAt("");
  };

  const handleRevoke = async (prefix) => {
    setRevoking(prefix);
    await revokeApiKey(prefix);
    setRevoking(null);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(newKeyValue);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleScope = (scope) => {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  };

  return (
    <>
      <div className="page-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 className="page-title">API Keys</h1>
          <p className="page-subtitle">Manage your authentication keys</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          Create New Key
        </button>
      </div>

      <div className="page-content">
        {newKeyValue && (
          <div className="key-created-alert">
            <div style={{ fontWeight: 600, marginBottom: 8 }}>
              New API Key Created
            </div>
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 12 }}>
              Copy this key now. It will not be shown again.
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <code style={{
                flex: 1,
                padding: "8px 12px",
                background: "var(--bg-tertiary)",
                borderRadius: 6,
                fontSize: 13,
                wordBreak: "break-all",
                fontFamily: "'SF Mono', Consolas, monospace",
              }}>
                {newKeyValue}
              </code>
              <button className="btn btn-secondary btn-sm" onClick={handleCopy}>
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <button
              className="btn btn-sm"
              style={{ marginTop: 12, color: "var(--text-muted)" }}
              onClick={clearNewKeyValue}
            >
              Dismiss
            </button>
          </div>
        )}

        {apiKeysLoading ? (
          <div className="loading-container">
            <div className="loading-spinner" />
          </div>
        ) : apiKeys.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-title">No API Keys</div>
            <div className="empty-state-message">
              Create your first API key to authenticate with ChittyConnect.
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Key</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Expires</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {apiKeys.map((k) => (
                    <tr key={k.key}>
                      <td>{k.name}</td>
                      <td style={{ fontFamily: "'SF Mono', Consolas, monospace", fontSize: 12 }}>
                        {k.key}
                      </td>
                      <td>
                        <span className={`status-badge ${k.status}`}>
                          {k.status}
                        </span>
                      </td>
                      <td style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                        {k.createdAt ? new Date(k.createdAt).toLocaleDateString() : "N/A"}
                      </td>
                      <td style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                        {k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : "Never"}
                      </td>
                      <td>
                        {k.status === "active" && (
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => handleRevoke(k.key.replace("...", ""))}
                            disabled={revoking === k.key}
                          >
                            {revoking === k.key ? "Revoking..." : "Revoke"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {showCreate && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Create API Key</span>
              <button className="modal-close" onClick={() => setShowCreate(false)}>
                &times;
              </button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Name</label>
                  <input
                    className="form-input"
                    placeholder="e.g. Claude Desktop"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    autoFocus
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Scopes</label>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {AVAILABLE_SCOPES.map((s) => (
                      <label
                        key={s}
                        className={`filter-chip ${scopes.includes(s) ? "active" : ""}`}
                        style={{ cursor: "pointer" }}
                      >
                        <input
                          type="checkbox"
                          checked={scopes.includes(s)}
                          onChange={() => toggleScope(s)}
                          style={{ display: "none" }}
                        />
                        {s}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Expires (optional)</label>
                  <input
                    type="date"
                    className="form-input"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={creating || !name.trim()}>
                  {creating ? "Creating..." : "Create Key"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
