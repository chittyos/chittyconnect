import React, { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuthStore } from "../stores/authStore";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated, login, loginLoading, loginError } = useAuthStore();

  const [apiKey, setApiKey] = useState("");
  const [remember, setRemember] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const from = location.state?.from?.pathname || "/";

  useEffect(() => {
    if (isAuthenticated) {
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, navigate, from]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const success = await login(apiKey, remember);
    if (success) {
      navigate(from, { replace: true });
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-logo">ChittyID</div>
        <div className="login-subtitle">Context Dashboard</div>

        <form onSubmit={handleSubmit}>
          {loginError && (
            <div className="login-error">{loginError}</div>
          )}

          <div className="form-group">
            <label className="form-label">API Key</label>
            <div className="input-with-toggle">
              <input
                type={showKey ? "text" : "password"}
                className="form-input"
                placeholder="chitty_..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoFocus
                required
              />
              <button
                type="button"
                className="input-toggle-btn"
                onClick={() => setShowKey(!showKey)}
                tabIndex={-1}
              >
                {showKey ? "Hide" : "Show"}
              </button>
            </div>
            <div className="form-hint">
              Starts with <code>chitty_</code>
            </div>
          </div>

          <div className="login-remember">
            <label>
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              Remember me
            </label>
          </div>

          <button
            type="submit"
            className="btn btn-primary login-btn"
            disabled={loginLoading || !apiKey.trim()}
          >
            {loginLoading ? (
              <span className="loading-spinner" style={{ width: 16, height: 16 }} />
            ) : (
              "Sign in"
            )}
          </button>
        </form>

        <div className="login-footer">
          Coming soon: Sign in with ChittyAuth
        </div>
      </div>
    </div>
  );
}
