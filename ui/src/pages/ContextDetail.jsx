import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDashboardStore } from '../stores/dashboardStore';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { format, formatDistanceToNow } from 'date-fns';

export default function ContextDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const {
    selectedContext,
    fetchContext,
    fetchTrustTimeline,
    fetchAlchemy,
    adjustTrust,
    previewDecommission,
    decommissionContext,
    reactivateContext,
    loading,
    clearSelectedContext,
  } = useDashboardStore();

  const [trustTimeline, setTrustTimeline] = useState(null);
  const [alchemy, setAlchemy] = useState(null);
  const [decommissionPreview, setDecommissionPreview] = useState(null);
  const [showDecommissionModal, setShowDecommissionModal] = useState(false);
  const [showTrustModal, setShowTrustModal] = useState(false);
  const [trustAdjustment, setTrustAdjustment] = useState({ amount: 0, reason: '' });
  const [decommissionForm, setDecommissionForm] = useState({ action: 'archive', reason: '', force: false });
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    fetchContext(id);
    return () => clearSelectedContext();
  }, [id, fetchContext, clearSelectedContext]);

  useEffect(() => {
    if (selectedContext?.context) {
      fetchTrustTimeline(selectedContext.context.id).then(setTrustTimeline);
      fetchAlchemy(selectedContext.context.id).then(setAlchemy);
    }
  }, [selectedContext, fetchTrustTimeline, fetchAlchemy]);

  const handleDecommissionClick = async () => {
    const preview = await previewDecommission(selectedContext.context.id);
    setDecommissionPreview(preview);
    setShowDecommissionModal(true);
  };

  const handleDecommission = async () => {
    const result = await decommissionContext(
      selectedContext.context.id,
      decommissionForm.action,
      decommissionForm.reason,
      decommissionForm.force
    );
    if (result.success) {
      setShowDecommissionModal(false);
      navigate('/contexts');
    }
  };

  const handleReactivate = async () => {
    const result = await reactivateContext(selectedContext.context.id, 'Manual reactivation');
    if (result.success) {
      fetchContext(id);
    }
  };

  const handleTrustAdjust = async () => {
    const result = await adjustTrust(
      selectedContext.context.id,
      trustAdjustment.amount,
      trustAdjustment.reason
    );
    if (result.success) {
      setShowTrustModal(false);
      setTrustAdjustment({ amount: 0, reason: '' });
      fetchTrustTimeline(selectedContext.context.id).then(setTrustTimeline);
    }
  };

  if (loading || !selectedContext) {
    return (
      <div className="loading-container">
        <div className="loading-spinner" />
      </div>
    );
  }

  const { context, dna, sessions, ledger, trustHistory } = selectedContext;

  return (
    <>
      <header className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <button
            onClick={() => navigate('/contexts')}
            className="btn btn-secondary btn-sm"
            style={{ padding: '8px 12px' }}
          >
            ← Back
          </button>
          <div>
            <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span className={`entity-avatar ${context.support_type}`} style={{ width: '36px', height: '36px', fontSize: '16px' }}>
                {context.support_type?.charAt(0).toUpperCase()}
              </span>
              Context Entity
            </h1>
            <p className="page-subtitle" style={{ fontFamily: 'monospace' }}>{context.chitty_id}</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          {context.status !== 'active' && context.status !== 'revoked' && (
            <button className="btn btn-primary btn-sm" onClick={handleReactivate}>
              Reactivate
            </button>
          )}
          {context.status === 'active' && (
            <button className="btn btn-danger btn-sm" onClick={handleDecommissionClick}>
              Decommission
            </button>
          )}
        </div>
      </header>

      <div className="page-content">
        {/* Status Bar */}
        <div className="stats-grid" style={{ marginBottom: '24px' }}>
          <div className="stat-card">
            <div className="stat-label">Status</div>
            <span className={`status-badge ${context.status}`} style={{ fontSize: '16px', padding: '6px 14px' }}>
              {context.status}
            </span>
          </div>
          <div className="stat-card">
            <div className="stat-label">Trust Level</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span className={`trust-badge level-${context.trust_level}`} style={{ fontSize: '14px' }}>
                Level {context.trust_level}
              </span>
              <span className="stat-value" style={{ fontSize: '24px' }}>{Math.round(context.trust_score)}%</span>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Active Sessions</div>
            <div className="stat-value">{sessions?.length || 0}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Total Sessions</div>
            <div className="stat-value">{context.total_sessions}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Success Rate</div>
            <div className="stat-value" style={{ color: 'var(--accent-success)' }}>
              {dna?.success_rate ? `${Math.round(dna.success_rate * 100)}%` : '-'}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', borderBottom: '1px solid var(--border-primary)', paddingBottom: '12px' }}>
          {['overview', 'dna', 'trust', 'alchemy', 'sessions', 'ledger'].map(tab => (
            <button
              key={tab}
              className={`filter-chip ${activeTab === tab ? 'active' : ''}`}
              onClick={() => setActiveTab(tab)}
              style={{ textTransform: 'capitalize' }}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'overview' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Basic Info</h3>
              </div>
              <div className="card-body">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Project Path</div>
                    <div style={{ fontFamily: 'monospace', fontSize: '14px' }}>{context.project_path}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Workspace</div>
                    <div>{context.workspace || 'None'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Support Type</div>
                    <div style={{ textTransform: 'capitalize' }}>{context.support_type}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Organization</div>
                    <div>{context.organization || 'None'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Created</div>
                    <div>{format(new Date(context.created_at * 1000), 'PPpp')}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Last Activity</div>
                    <div>{formatDistanceToNow(new Date(context.last_activity * 1000), { addSuffix: true })}</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <h3 className="card-title">Quick Actions</h3>
              </div>
              <div className="card-body">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <button
                    className="btn btn-secondary"
                    onClick={() => setShowTrustModal(true)}
                    style={{ justifyContent: 'flex-start' }}
                  >
                    Adjust Trust Score
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => setActiveTab('alchemy')}
                    style={{ justifyContent: 'flex-start' }}
                  >
                    View Alchemy Suggestions
                  </button>
                  <button
                    className="btn btn-secondary"
                    onClick={() => setActiveTab('ledger')}
                    style={{ justifyContent: 'flex-start' }}
                  >
                    View Event Ledger
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'dna' && (
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Context DNA</h3>
            </div>
            <div className="card-body">
              {dna ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
                  <div>
                    <h4 style={{ fontSize: '14px', marginBottom: '12px', color: 'var(--text-secondary)' }}>Competencies</h4>
                    {dna.competencies?.length > 0 ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {dna.competencies.map((c, i) => (
                          <span key={i} className="entity-tag">
                            {typeof c === 'string' ? c : c.name}
                          </span>
                        ))}
                      </div>
                    ) : <span style={{ color: 'var(--text-muted)' }}>No competencies recorded</span>}
                  </div>
                  <div>
                    <h4 style={{ fontSize: '14px', marginBottom: '12px', color: 'var(--text-secondary)' }}>Expertise Domains</h4>
                    {dna.expertise_domains?.length > 0 ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {dna.expertise_domains.map((d, i) => (
                          <span key={i} className="entity-tag">{d}</span>
                        ))}
                      </div>
                    ) : <span style={{ color: 'var(--text-muted)' }}>No expertise domains</span>}
                  </div>
                  <div>
                    <h4 style={{ fontSize: '14px', marginBottom: '12px', color: 'var(--text-secondary)' }}>Traits</h4>
                    {dna.traits?.length > 0 ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        {dna.traits.map((t, i) => (
                          <span key={i} className="entity-tag">{typeof t === 'string' ? t : t.name}</span>
                        ))}
                      </div>
                    ) : <span style={{ color: 'var(--text-muted)' }}>No traits recorded</span>}
                  </div>
                  <div>
                    <h4 style={{ fontSize: '14px', marginBottom: '12px', color: 'var(--text-secondary)' }}>Metrics</h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div>Interactions: {dna.total_interactions}</div>
                      <div>Decisions: {dna.total_decisions}</div>
                      <div>Successful: {dna.outcomes_successful}</div>
                      <div>Failed: {dna.outcomes_failed}</div>
                      <div>Anomalies: {dna.anomaly_count}</div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="empty-state">
                  <p>No DNA data available yet</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'trust' && (
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Trust Evolution</h3>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowTrustModal(true)}>
                Adjust Trust
              </button>
            </div>
            <div className="card-body">
              {trustTimeline?.timeline?.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={trustTimeline.timeline}>
                      <XAxis
                        dataKey="timestamp"
                        tickFormatter={(v) => format(new Date(v), 'MMM d')}
                        stroke="var(--text-muted)"
                      />
                      <YAxis domain={[0, 100]} stroke="var(--text-muted)" />
                      <Tooltip
                        contentStyle={{
                          background: 'var(--bg-secondary)',
                          border: '1px solid var(--border-primary)',
                          borderRadius: '8px',
                        }}
                        labelFormatter={(v) => format(new Date(v), 'PPpp')}
                      />
                      <Line
                        type="monotone"
                        dataKey="new_trust_score"
                        stroke="var(--accent-primary)"
                        strokeWidth={2}
                        dot={{ fill: 'var(--accent-primary)', r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>

                  <div className="timeline" style={{ marginTop: '24px' }}>
                    {trustHistory?.slice(0, 10).map((event, i) => (
                      <div key={i} className="timeline-item">
                        <div className="timeline-time">
                          {formatDistanceToNow(new Date(event.changed_at * 1000), { addSuffix: true })}
                        </div>
                        <div className="timeline-content">
                          Trust changed from {Math.round(event.previous_trust_score)}% to {Math.round(event.new_trust_score)}%
                        </div>
                        <div className="timeline-details">{event.change_trigger}</div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="empty-state">
                  <p>No trust changes recorded</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'alchemy' && (
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Alchemy Suggestions</h3>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Recommended MCP tools based on context DNA
              </span>
            </div>
            <div className="card-body">
              {alchemy?.suggestions?.length > 0 ? (
                <div className="alchemy-list">
                  {alchemy.suggestions.map((suggestion, i) => (
                    <div key={i} className="alchemy-item">
                      <div className="alchemy-icon">⚗️</div>
                      <div className="alchemy-info">
                        <div className="alchemy-tool">{suggestion.tool}</div>
                        <div className="alchemy-reason">{suggestion.reason}</div>
                      </div>
                      <div className="alchemy-confidence">
                        {Math.round(suggestion.confidence * 100)}%
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <p>No suggestions available</p>
                </div>
              )}
              {alchemy?.reasoning && (
                <div style={{ marginTop: '16px', padding: '12px', background: 'var(--bg-tertiary)', borderRadius: '8px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                  {alchemy.reasoning}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'sessions' && (
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Active Sessions</h3>
            </div>
            <div className="card-body">
              {sessions?.length > 0 ? (
                <div className="table-container">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Session ID</th>
                        <th>Platform</th>
                        <th>Bound</th>
                        <th>Interactions</th>
                        <th>Last Activity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessions.map(session => (
                        <tr key={session.id}>
                          <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                            {session.session_id?.slice(0, 24)}...
                          </td>
                          <td>{session.platform || 'unknown'}</td>
                          <td>{formatDistanceToNow(new Date(session.bound_at * 1000), { addSuffix: true })}</td>
                          <td>{session.interactions_count}</td>
                          <td>{formatDistanceToNow(new Date(session.last_activity * 1000), { addSuffix: true })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state">
                  <p>No active sessions</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'ledger' && (
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Event Ledger</h3>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                Immutable chain of context events
              </span>
            </div>
            <div className="card-body">
              {ledger?.length > 0 ? (
                <div className="timeline">
                  {ledger.map((event, i) => (
                    <div key={i} className="timeline-item">
                      <div className="timeline-time">
                        {format(new Date(event.timestamp * 1000), 'PPpp')}
                      </div>
                      <div className="timeline-content">
                        <span className={`status-badge ${event.event_type}`}>{event.event_type}</span>
                      </div>
                      <div className="timeline-details">
                        {JSON.stringify(event.payload).slice(0, 100)}...
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <p>No ledger entries</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Trust Adjustment Modal */}
      {showTrustModal && (
        <div className="modal-overlay" onClick={() => setShowTrustModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Adjust Trust Score</h3>
              <button className="modal-close" onClick={() => setShowTrustModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Current Score: {Math.round(context.trust_score)}%</label>
                <input
                  type="range"
                  min="-50"
                  max="50"
                  value={trustAdjustment.amount}
                  onChange={(e) => setTrustAdjustment({ ...trustAdjustment, amount: parseInt(e.target.value) })}
                  style={{ width: '100%' }}
                />
                <div style={{ textAlign: 'center', marginTop: '8px' }}>
                  Adjustment: {trustAdjustment.amount > 0 ? '+' : ''}{trustAdjustment.amount}%
                  → New: {Math.max(0, Math.min(100, context.trust_score + trustAdjustment.amount))}%
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Reason *</label>
                <textarea
                  className="form-input"
                  rows="3"
                  value={trustAdjustment.reason}
                  onChange={(e) => setTrustAdjustment({ ...trustAdjustment, reason: e.target.value })}
                  placeholder="Why are you adjusting this trust score?"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowTrustModal(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={handleTrustAdjust}
                disabled={!trustAdjustment.reason || trustAdjustment.amount === 0}
              >
                Apply Adjustment
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Decommission Modal */}
      {showDecommissionModal && decommissionPreview && (
        <div className="modal-overlay" onClick={() => setShowDecommissionModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Decommission Context</h3>
              <button className="modal-close" onClick={() => setShowDecommissionModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div style={{ background: 'rgba(239, 68, 68, 0.1)', padding: '16px', borderRadius: '8px', marginBottom: '20px' }}>
                <h4 style={{ color: 'var(--accent-danger)', marginBottom: '8px' }}>Impact Preview</h4>
                <ul style={{ margin: 0, paddingLeft: '20px', color: 'var(--text-secondary)' }}>
                  <li>{decommissionPreview.impact.active_sessions_to_unbind} active sessions will be unbound</li>
                  <li>{decommissionPreview.impact.ledger_entries_archived} ledger entries will be archived</li>
                  <li>{decommissionPreview.impact.trust_logs_archived} trust logs will be archived</li>
                </ul>
                {decommissionPreview.warnings?.length > 0 && (
                  <div style={{ marginTop: '12px', color: 'var(--accent-warning)' }}>
                    {decommissionPreview.warnings.map((w, i) => (
                      <div key={i}>⚠️ {w}</div>
                    ))}
                  </div>
                )}
              </div>

              <div className="form-group">
                <label className="form-label">Action</label>
                <select
                  className="form-select"
                  value={decommissionForm.action}
                  onChange={(e) => setDecommissionForm({ ...decommissionForm, action: e.target.value })}
                >
                  <option value="archive">Archive (can be reactivated)</option>
                  <option value="revoke">Revoke (permanent)</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Reason *</label>
                <textarea
                  className="form-input"
                  rows="3"
                  value={decommissionForm.reason}
                  onChange={(e) => setDecommissionForm({ ...decommissionForm, reason: e.target.value })}
                  placeholder="Why are you decommissioning this context?"
                />
              </div>

              {decommissionPreview.impact.active_sessions_to_unbind > 0 && (
                <div className="form-group">
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="checkbox"
                      checked={decommissionForm.force}
                      onChange={(e) => setDecommissionForm({ ...decommissionForm, force: e.target.checked })}
                    />
                    Force unbind active sessions
                  </label>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowDecommissionModal(false)}>Cancel</button>
              <button
                className="btn btn-danger"
                onClick={handleDecommission}
                disabled={!decommissionForm.reason || (decommissionPreview.impact.active_sessions_to_unbind > 0 && !decommissionForm.force)}
              >
                {decommissionForm.action === 'revoke' ? 'Revoke Context' : 'Archive Context'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
