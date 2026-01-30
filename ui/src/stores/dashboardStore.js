import { create } from 'zustand';

const API_BASE = import.meta.env.PROD
  ? 'https://connect.chitty.cc'
  : '';

export const useDashboardStore = create((set, get) => ({
  // State
  contexts: [],
  selectedContext: null,
  stats: null,
  approvals: [],
  teamCandidates: [],
  loading: false,
  error: null,

  // Filters
  filters: {
    status: 'active',
    support_type: null,
    trust_level: null,
  },

  // Actions
  setFilters: (newFilters) => set((state) => ({
    filters: { ...state.filters, ...newFilters }
  })),

  // Fetch contexts list
  fetchContexts: async () => {
    set({ loading: true, error: null });
    try {
      const { filters } = get();
      const params = new URLSearchParams();
      if (filters.status) params.set('status', filters.status);
      if (filters.support_type) params.set('support_type', filters.support_type);
      if (filters.trust_level) params.set('trust_level', filters.trust_level);

      const response = await fetch(`${API_BASE}/api/dashboard/contexts?${params}`);
      const data = await response.json();

      if (data.success) {
        set({ contexts: data.data.contexts, loading: false });
      } else {
        set({ error: data.error, loading: false });
      }
    } catch (err) {
      set({ error: err.message, loading: false });
    }
  },

  // Fetch single context with full details
  fetchContext: async (id) => {
    set({ loading: true, error: null });
    try {
      const response = await fetch(`${API_BASE}/api/dashboard/contexts/${id}`);
      const data = await response.json();

      if (data.success) {
        set({ selectedContext: data.data, loading: false });
        return data.data;
      } else {
        set({ error: data.error, loading: false });
        return null;
      }
    } catch (err) {
      set({ error: err.message, loading: false });
      return null;
    }
  },

  // Fetch dashboard stats
  fetchStats: async () => {
    try {
      const response = await fetch(`${API_BASE}/api/dashboard/stats`);
      const data = await response.json();

      if (data.success) {
        set({ stats: data.data });
      }
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  },

  // Fetch approvals
  fetchApprovals: async (status = 'pending') => {
    try {
      const response = await fetch(`${API_BASE}/api/dashboard/approvals?status=${status}`);
      const data = await response.json();

      if (data.success) {
        set({ approvals: data.data.approvals });
      }
    } catch (err) {
      console.error('Failed to fetch approvals:', err);
    }
  },

  // Approve request
  approveRequest: async (approvalId, approverChittyId, notes) => {
    try {
      const response = await fetch(`${API_BASE}/api/dashboard/approvals/${approvalId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approver_chitty_id: approverChittyId, notes }),
      });
      const data = await response.json();

      if (data.success) {
        get().fetchApprovals();
        return { success: true };
      }
      return { success: false, error: data.error };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  // Deny request
  denyRequest: async (approvalId, denierChittyId, reason) => {
    try {
      const response = await fetch(`${API_BASE}/api/dashboard/approvals/${approvalId}/deny`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ denier_chitty_id: denierChittyId, reason }),
      });
      const data = await response.json();

      if (data.success) {
        get().fetchApprovals();
        return { success: true };
      }
      return { success: false, error: data.error };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  // Get trust timeline
  fetchTrustTimeline: async (contextId, days = 30) => {
    try {
      const response = await fetch(
        `${API_BASE}/api/dashboard/contexts/${contextId}/trust-timeline?days=${days}`
      );
      const data = await response.json();
      return data.success ? data.data : null;
    } catch (err) {
      console.error('Failed to fetch trust timeline:', err);
      return null;
    }
  },

  // Adjust trust
  adjustTrust: async (contextId, adjustment, reason) => {
    try {
      const response = await fetch(`${API_BASE}/api/dashboard/contexts/${contextId}/trust/adjust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adjustment, reason }),
      });
      const data = await response.json();

      if (data.success) {
        get().fetchContext(contextId);
        return { success: true, data: data.data };
      }
      return { success: false, error: data.error };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  // Decommission preview
  previewDecommission: async (contextId) => {
    try {
      const response = await fetch(
        `${API_BASE}/api/dashboard/contexts/${contextId}/decommission/preview`
      );
      const data = await response.json();
      return data.success ? data.data : null;
    } catch (err) {
      console.error('Failed to preview decommission:', err);
      return null;
    }
  },

  // Decommission context
  decommissionContext: async (contextId, action, reason, force = false) => {
    try {
      const response = await fetch(`${API_BASE}/api/dashboard/contexts/${contextId}/decommission`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason, force }),
      });
      const data = await response.json();

      if (data.success) {
        get().fetchContexts();
        return { success: true, data: data.data };
      }
      return { success: false, error: data.error };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  // Reactivate context
  reactivateContext: async (contextId, reason) => {
    try {
      const response = await fetch(`${API_BASE}/api/dashboard/contexts/${contextId}/reactivate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const data = await response.json();

      if (data.success) {
        get().fetchContexts();
        return { success: true };
      }
      return { success: false, error: data.error };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  // Get Alchemy suggestions
  fetchAlchemy: async (contextId) => {
    try {
      const response = await fetch(`${API_BASE}/api/dashboard/contexts/${contextId}/alchemy`);
      const data = await response.json();
      return data.success ? data.data : null;
    } catch (err) {
      console.error('Failed to fetch alchemy suggestions:', err);
      return null;
    }
  },

  // Fetch team candidates
  fetchTeamCandidates: async (criteria = {}) => {
    try {
      const params = new URLSearchParams();
      if (criteria.support_types) params.set('support_types', criteria.support_types);
      if (criteria.min_trust_level) params.set('min_trust_level', criteria.min_trust_level);
      if (criteria.required_competencies) params.set('required_competencies', criteria.required_competencies);

      const response = await fetch(`${API_BASE}/api/dashboard/team-candidates?${params}`);
      const data = await response.json();

      if (data.success) {
        set({ teamCandidates: data.data.candidates });
        return data.data.candidates;
      }
      return [];
    } catch (err) {
      console.error('Failed to fetch team candidates:', err);
      return [];
    }
  },

  // Bind team to project
  bindTeamToProject: async (projectId, contextIds, roleAssignments = {}) => {
    try {
      const response = await fetch(`${API_BASE}/api/dashboard/projects/${projectId}/bind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context_ids: contextIds, role_assignments: roleAssignments }),
      });
      const data = await response.json();
      return data.success ? data.data : null;
    } catch (err) {
      console.error('Failed to bind team:', err);
      return null;
    }
  },

  // Get project team
  fetchProjectTeam: async (projectId) => {
    try {
      const response = await fetch(`${API_BASE}/api/dashboard/projects/${projectId}/team`);
      const data = await response.json();
      return data.success ? data.data : null;
    } catch (err) {
      console.error('Failed to fetch project team:', err);
      return null;
    }
  },

  clearSelectedContext: () => set({ selectedContext: null }),
}));
