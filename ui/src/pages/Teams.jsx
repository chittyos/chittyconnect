import { useEffect, useState } from 'react';
import { useDashboardStore } from '../stores/dashboardStore';

const SUPPORT_TYPES = ['development', 'operations', 'legal', 'research', 'financial', 'administrative'];

export default function Teams() {
  const { teamCandidates, fetchTeamCandidates, bindTeamToProject, fetchProjectTeam } = useDashboardStore();

  const [criteria, setCriteria] = useState({
    support_types: [],
    min_trust_level: 2,
    required_competencies: '',
  });
  const [selectedCandidates, setSelectedCandidates] = useState(new Set());
  const [roleAssignments, setRoleAssignments] = useState({});
  const [projectId, setProjectId] = useState('');
  const [existingTeam, setExistingTeam] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showBindModal, setShowBindModal] = useState(false);
  const [bindResult, setBindResult] = useState(null);

  useEffect(() => {
    handleSearch();
  }, []);

  const handleSearch = async () => {
    setLoading(true);
    await fetchTeamCandidates({
      support_types: criteria.support_types.join(','),
      min_trust_level: criteria.min_trust_level,
      required_competencies: criteria.required_competencies,
    });
    setLoading(false);
  };

  const toggleSupportType = (type) => {
    setCriteria(prev => ({
      ...prev,
      support_types: prev.support_types.includes(type)
        ? prev.support_types.filter(t => t !== type)
        : [...prev.support_types, type]
    }));
  };

  const toggleCandidate = (id) => {
    setSelectedCandidates(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        const newRoles = { ...roleAssignments };
        delete newRoles[id];
        setRoleAssignments(newRoles);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const selectAll = () => {
    if (selectedCandidates.size === teamCandidates.length) {
      setSelectedCandidates(new Set());
      setRoleAssignments({});
    } else {
      setSelectedCandidates(new Set(teamCandidates.map(c => c.id)));
    }
  };

  const handleBindTeam = async () => {
    if (!projectId || selectedCandidates.size === 0) return;

    setLoading(true);
    const result = await bindTeamToProject(
      projectId,
      Array.from(selectedCandidates),
      roleAssignments
    );
    setLoading(false);

    if (result) {
      setBindResult(result);
      setShowBindModal(false);
      setSelectedCandidates(new Set());
      setRoleAssignments({});
    }
  };

  const lookupProjectTeam = async () => {
    if (!projectId) return;
    setLoading(true);
    const team = await fetchProjectTeam(projectId);
    setExistingTeam(team);
    setLoading(false);
  };

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">Team Builder</h1>
        <p className="page-subtitle">Assemble context entity teams for projects with intelligent matching</p>
      </header>

      <div className="page-content">
        {/* Search Criteria */}
        <div className="card" style={{ marginBottom: '24px' }}>
          <div className="card-header">
            <h3 className="card-title">Search Criteria</h3>
            <button className="btn btn-primary btn-sm" onClick={handleSearch}>
              Search
            </button>
          </div>
          <div className="card-body">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
              <div>
                <label className="form-label">Support Types</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {SUPPORT_TYPES.map(type => (
                    <button
                      key={type}
                      className={`filter-chip ${criteria.support_types.includes(type) ? 'active' : ''}`}
                      onClick={() => toggleSupportType(type)}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="form-label">Minimum Trust Level: {criteria.min_trust_level}</label>
                <input
                  type="range"
                  min="0"
                  max="5"
                  value={criteria.min_trust_level}
                  onChange={(e) => setCriteria({ ...criteria, min_trust_level: parseInt(e.target.value) })}
                  style={{ width: '100%' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)' }}>
                  <span>L0</span>
                  <span>L5</span>
                </div>
              </div>
              <div>
                <label className="form-label">Required Competencies</label>
                <input
                  type="text"
                  className="form-input"
                  value={criteria.required_competencies}
                  onChange={(e) => setCriteria({ ...criteria, required_competencies: e.target.value })}
                  placeholder="e.g., code_review, testing"
                />
                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                  Comma-separated competency keywords
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Results */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px' }}>
          {/* Candidates List */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">
                Candidates ({teamCandidates.length})
                {selectedCandidates.size > 0 && (
                  <span style={{ fontWeight: 'normal', color: 'var(--accent-primary)', marginLeft: '8px' }}>
                    {selectedCandidates.size} selected
                  </span>
                )}
              </h3>
              <button className="btn btn-secondary btn-sm" onClick={selectAll}>
                {selectedCandidates.size === teamCandidates.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>
            <div className="card-body" style={{ maxHeight: '600px', overflowY: 'auto' }}>
              {loading ? (
                <div className="loading-container">
                  <div className="loading-spinner" />
                </div>
              ) : teamCandidates.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {teamCandidates.map(candidate => (
                    <div
                      key={candidate.id}
                      className="team-member"
                      style={{
                        border: selectedCandidates.has(candidate.id) ? '1px solid var(--accent-primary)' : '1px solid transparent',
                        cursor: 'pointer',
                      }}
                      onClick={() => toggleCandidate(candidate.id)}
                    >
                      <input
                        type="checkbox"
                        className="team-member-checkbox"
                        checked={selectedCandidates.has(candidate.id)}
                        onChange={() => toggleCandidate(candidate.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className={`entity-avatar ${candidate.support_type}`} style={{ width: '40px', height: '40px', fontSize: '16px' }}>
                        {candidate.support_type?.charAt(0).toUpperCase()}
                      </div>
                      <div className="team-member-info">
                        <div className="team-member-name" style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                          {candidate.chitty_id?.slice(0, 24)}...
                        </div>
                        <div className="team-member-role">
                          {candidate.project_path?.split('/').pop()} • {candidate.support_type}
                        </div>
                      </div>
                      <span className={`trust-badge level-${candidate.trust_level}`}>
                        L{candidate.trust_level}
                      </span>
                      <div style={{ textAlign: 'right', marginLeft: '12px' }}>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                          {candidate.total_interactions || 0} interactions
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          {candidate.success_rate ? `${Math.round(candidate.success_rate * 100)}% success` : 'No data'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <div className="empty-state-title">No candidates found</div>
                  <div className="empty-state-message">
                    Try adjusting your search criteria
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Team Assembly Panel */}
          <div>
            <div className="card" style={{ marginBottom: '20px' }}>
              <div className="card-header">
                <h3 className="card-title">Assemble Team</h3>
              </div>
              <div className="card-body">
                <div className="form-group">
                  <label className="form-label">Project ID *</label>
                  <input
                    type="text"
                    className="form-input"
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    placeholder="e.g., my-project-2024"
                  />
                </div>

                {selectedCandidates.size > 0 && (
                  <div style={{ marginBottom: '16px' }}>
                    <label className="form-label">Role Assignments (optional)</label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {Array.from(selectedCandidates).map(id => {
                        const candidate = teamCandidates.find(c => c.id === id);
                        return candidate ? (
                          <div key={id} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ flex: 1, fontSize: '12px', fontFamily: 'monospace' }}>
                              {candidate.chitty_id?.slice(0, 16)}...
                            </span>
                            <select
                              className="form-select"
                              style={{ width: 'auto', padding: '4px 8px', fontSize: '12px' }}
                              value={roleAssignments[id] || candidate.support_type}
                              onChange={(e) => setRoleAssignments({
                                ...roleAssignments,
                                [id]: e.target.value
                              })}
                            >
                              {SUPPORT_TYPES.map(type => (
                                <option key={type} value={type}>{type}</option>
                              ))}
                            </select>
                          </div>
                        ) : null;
                      })}
                    </div>
                  </div>
                )}

                <button
                  className="btn btn-primary"
                  style={{ width: '100%' }}
                  onClick={() => setShowBindModal(true)}
                  disabled={!projectId || selectedCandidates.size === 0}
                >
                  Bind Team to Project ({selectedCandidates.size})
                </button>
              </div>
            </div>

            {/* Lookup Existing Team */}
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Lookup Project Team</h3>
              </div>
              <div className="card-body">
                <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                  <input
                    type="text"
                    className="form-input"
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                    placeholder="Project ID"
                    style={{ flex: 1 }}
                  />
                  <button
                    className="btn btn-secondary"
                    onClick={lookupProjectTeam}
                    disabled={!projectId}
                  >
                    Lookup
                  </button>
                </div>

                {existingTeam && (
                  <div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                      Team Size: {existingTeam.team_size}
                    </div>
                    {existingTeam.team?.map((member, i) => (
                      <div key={i} className="team-member" style={{ marginBottom: '8px' }}>
                        <div className={`entity-avatar ${member.support_type}`} style={{ width: '32px', height: '32px', fontSize: '14px' }}>
                          {member.support_type?.charAt(0).toUpperCase()}
                        </div>
                        <div className="team-member-info">
                          <div className="team-member-name" style={{ fontSize: '12px', fontFamily: 'monospace' }}>
                            {member.context_chitty_id?.slice(0, 20)}...
                          </div>
                          <div className="team-member-role">
                            {member.payload?.role || member.support_type}
                          </div>
                        </div>
                        <span className={`trust-badge level-${member.trust_level}`}>
                          L{member.trust_level}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Bind Result */}
        {bindResult && (
          <div className="card" style={{ marginTop: '24px', background: 'rgba(34, 197, 94, 0.1)', borderColor: 'var(--accent-success)' }}>
            <div className="card-body">
              <h3 style={{ color: 'var(--accent-success)', marginBottom: '12px' }}>Team Successfully Bound!</h3>
              <div>Project: {bindResult.project_id}</div>
              <div>Team Size: {bindResult.team_size}</div>
              <div style={{ marginTop: '12px' }}>
                {bindResult.bindings?.map((b, i) => (
                  <div key={i} style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                    • {b.chitty_id?.slice(0, 24)}... ({b.role})
                  </div>
                ))}
              </div>
              <button
                className="btn btn-secondary btn-sm"
                style={{ marginTop: '12px' }}
                onClick={() => setBindResult(null)}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bind Confirmation Modal */}
      {showBindModal && (
        <div className="modal-overlay" onClick={() => setShowBindModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Confirm Team Binding</h3>
              <button className="modal-close" onClick={() => setShowBindModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Project</div>
                <div style={{ fontSize: '16px', fontWeight: '600' }}>{projectId}</div>
              </div>
              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                  Team Members ({selectedCandidates.size})
                </div>
                {Array.from(selectedCandidates).map(id => {
                  const candidate = teamCandidates.find(c => c.id === id);
                  return candidate ? (
                    <div key={id} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <div className={`entity-avatar ${candidate.support_type}`} style={{ width: '28px', height: '28px', fontSize: '12px' }}>
                        {candidate.support_type?.charAt(0).toUpperCase()}
                      </div>
                      <span style={{ flex: 1, fontSize: '12px', fontFamily: 'monospace' }}>
                        {candidate.chitty_id?.slice(0, 20)}...
                      </span>
                      <span className="entity-tag">
                        {roleAssignments[id] || candidate.support_type}
                      </span>
                    </div>
                  ) : null;
                })}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowBindModal(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleBindTeam} disabled={loading}>
                {loading ? 'Binding...' : 'Bind Team'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
