import { create } from "zustand";

const API_BASE = import.meta.env.PROD ? "https://connect.chitty.cc" : "";
const STORAGE_KEY = "chitty_api_key";

function loadToken() {
  return sessionStorage.getItem(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY) || null;
}

export const useAuthStore = create((set, get) => ({
  token: loadToken(),
  user: null,
  isAuthenticated: !!loadToken(),
  loginLoading: false,
  loginError: null,

  // API key management
  apiKeys: [],
  apiKeysLoading: false,
  newKeyValue: null,

  getAuthHeaders: () => {
    const { token } = get();
    return token ? { "X-ChittyOS-API-Key": token } : {};
  },

  login: async (apiKey, remember = false) => {
    set({ loginLoading: true, loginError: null });
    try {
      const response = await fetch(`${API_BASE}/api/auth/keys/me`, {
        headers: { "X-ChittyOS-API-Key": apiKey },
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        set({
          loginLoading: false,
          loginError: data.error || "Invalid API key",
        });
        return false;
      }

      const data = await response.json();

      if (remember) {
        localStorage.setItem(STORAGE_KEY, apiKey);
      } else {
        sessionStorage.setItem(STORAGE_KEY, apiKey);
      }

      set({
        token: apiKey,
        user: data.data,
        isAuthenticated: true,
        loginLoading: false,
        loginError: null,
      });
      return true;
    } catch (err) {
      set({
        loginLoading: false,
        loginError: err.message || "Connection failed",
      });
      return false;
    }
  },

  logout: () => {
    sessionStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
    set({
      token: null,
      user: null,
      isAuthenticated: false,
      loginError: null,
      apiKeys: [],
      newKeyValue: null,
    });
  },

  fetchProfile: async () => {
    const { token } = get();
    if (!token) return;

    try {
      const response = await fetch(`${API_BASE}/api/auth/keys/me`, {
        headers: { "X-ChittyOS-API-Key": token },
      });

      if (response.status === 401) {
        get().logout();
        return;
      }

      const data = await response.json();
      if (data.success) {
        set({ user: data.data });
      }
    } catch {
      // silent
    }
  },

  fetchApiKeys: async () => {
    const { token } = get();
    if (!token) return;

    set({ apiKeysLoading: true });
    try {
      const response = await fetch(`${API_BASE}/api/auth/keys`, {
        headers: { "X-ChittyOS-API-Key": token },
      });

      if (response.status === 401) {
        get().logout();
        return;
      }

      const data = await response.json();
      if (data.success) {
        set({ apiKeys: data.data.keys, apiKeysLoading: false });
      } else {
        set({ apiKeysLoading: false });
      }
    } catch {
      set({ apiKeysLoading: false });
    }
  },

  createApiKey: async (name, scopes, expiresAt) => {
    const { token } = get();
    if (!token) return false;

    try {
      const response = await fetch(`${API_BASE}/api/auth/keys`, {
        method: "POST",
        headers: {
          "X-ChittyOS-API-Key": token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name, scopes, expiresAt: expiresAt || null }),
      });

      if (response.status === 401) {
        get().logout();
        return false;
      }

      const data = await response.json();
      if (data.success) {
        set({ newKeyValue: data.data.key });
        get().fetchApiKeys();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  revokeApiKey: async (prefix) => {
    const { token } = get();
    if (!token) return false;

    try {
      const response = await fetch(`${API_BASE}/api/auth/keys/${prefix}`, {
        method: "DELETE",
        headers: { "X-ChittyOS-API-Key": token },
      });

      if (response.status === 401) {
        get().logout();
        return false;
      }

      const data = await response.json();
      if (data.success) {
        get().fetchApiKeys();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  clearNewKeyValue: () => set({ newKeyValue: null }),
}));
