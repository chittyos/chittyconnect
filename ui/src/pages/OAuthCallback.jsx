import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

export default function OAuthCallback() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [countdown, setCountdown] = useState(3);

  const code = searchParams.get("code");
  const state = searchParams.get("state");

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          navigate("/login", { replace: true });
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [navigate]);

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-logo">ChittyID</div>
        <div className="login-subtitle">OAuth Callback</div>

        <div style={{ textAlign: "center", marginTop: 24 }}>
          <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>
            OAuth authentication is not yet available.
          </p>
          {code && (
            <p style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 8, fontFamily: "'SF Mono', Consolas, monospace" }}>
              code: {code.substring(0, 16)}...
            </p>
          )}
          <p style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 16 }}>
            Redirecting to login in {countdown}...
          </p>
        </div>
      </div>
    </div>
  );
}
