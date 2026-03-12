import React from "react";
import { useAuthStore } from "../stores/authStore";

export default function UserMenu() {
  const { user, logout } = useAuthStore();

  if (!user) return null;

  const displayName = user.name || "API Key User";
  const displayId = user.userId || "unknown";

  return (
    <div className="user-menu">
      <div className="user-menu-info">
        <div className="user-menu-name" title={displayName}>
          {displayName}
        </div>
        <div className="user-menu-id" title={displayId}>
          {displayId}
        </div>
      </div>
      <button
        className="user-menu-logout"
        onClick={logout}
        title="Sign out"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
          <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
      </button>
    </div>
  );
}
