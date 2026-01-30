import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useDashboardStore } from '../stores/dashboardStore';

const SUPPORT_TYPES = ['development', 'operations', 'legal', 'research', 'financial', 'administrative'];
const TRUST_LEVELS = [0, 1, 2, 3, 4, 5];

export default function Contexts() {
  const { contexts, filters, setFilters, fetchContexts, loading } = useDashboardStore();

  useEffect(() => {
    fetchContexts();
  }, [filters, fetchContexts]);

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">Context Entities</h1>
        <p className="page-subtitle">Manage and monitor all synthetic context entities</p>
      </header>

      <div className="page-content">
        {/* Filters */}
        <div className="filters-bar">
          <span style={{ fontSize: '13px', color: 'var(--text-muted)', marginRight: '8px' }}>Status:</span>
          {['active', 'dormant', 'archived', 'revoked'].map(status => (
            <button
              key={status}
              className={`filter-chip ${filters.status === status ? 'active' : ''}`}
              onClick={() => setFilters({ status: filters.status === status ? null : status })}
            >
              {status}
            </button>
          ))}

          <span style={{ fontSize: '13px', color: 'var(--text-muted)', marginLeft: '16px', marginRight: '8px' }}>Type:</span>
          {SUPPORT_TYPES.map(type => (
            <button
              key={type}
              className={`filter-chip ${filters.support_type === type ? 'active' : ''}`}
              onClick={() => setFilters({ support_type: filters.support_type === type ? null : type })}
            >
              {type}
            </button>
          ))}

          <span style={{ fontSize: '13px', color: 'var(--text-muted)', marginLeft: '16px', marginRight: '8px' }}>Trust:</span>
          {TRUST_LEVELS.map(level => (
            <button
              key={level}
              className={`filter-chip ${filters.trust_level === level ? 'active' : ''}`}
              onClick={() => setFilters({ trust_level: filters.trust_level === level ? null : level })}
            >
              L{level}+
            </button>
          ))}
        </div>

        {/* Results */}
        {loading ? (
          <div className="loading-container">
            <div className="loading-spinner" />
          </div>
        ) : contexts.length > 0 ? (
          <div className="entity-grid">
            {contexts.map(ctx => (
              <Link
                key={ctx.id}
                to={`/contexts/${ctx.id}`}
                className="entity-card"
                style={{ textDecoration: 'none' }}
              >
                <div className="entity-header">
                  <div className={`entity-avatar ${ctx.support_type}`}>
                    {ctx.support_type?.charAt(0).toUpperCase()}
                  </div>
                  <div className="entity-trust">
                    <span className={`trust-badge level-${ctx.trust_level}`}>
                      Level {ctx.trust_level}
                    </span>
                    <span className="trust-score">{Math.round(ctx.trust_score)}% trust</span>
                  </div>
                </div>

                <div className="entity-info">
                  <div className="entity-name" title={ctx.chitty_id}>
                    {ctx.chitty_id?.slice(0, 24)}...
                  </div>
                  <div className="entity-path">{ctx.project_path}</div>
                </div>

                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                  <span className={`status-badge ${ctx.status}`}>{ctx.status}</span>
                  <span className="entity-tag">{ctx.support_type}</span>
                  {ctx.workspace && <span className="entity-tag">{ctx.workspace}</span>}
                </div>

                <div className="entity-stats">
                  <div className="entity-stat">
                    <div className="entity-stat-label">Sessions</div>
                    <div className="entity-stat-value">{ctx.active_sessions || 0}</div>
                  </div>
                  <div className="entity-stat">
                    <div className="entity-stat-label">Total Sessions</div>
                    <div className="entity-stat-value">{ctx.total_sessions || 0}</div>
                  </div>
                  <div className="entity-stat">
                    <div className="entity-stat-label">Success Rate</div>
                    <div className="entity-stat-value">
                      {ctx.success_rate != null ? `${Math.round(ctx.success_rate * 100)}%` : '-'}
                    </div>
                  </div>
                </div>

                {ctx.expertise_domains?.length > 0 && (
                  <div className="entity-tags">
                    {ctx.expertise_domains.slice(0, 3).map((domain, i) => (
                      <span key={i} className="entity-tag">{domain}</span>
                    ))}
                    {ctx.expertise_domains.length > 3 && (
                      <span className="entity-tag">+{ctx.expertise_domains.length - 3}</span>
                    )}
                  </div>
                )}
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-state-title">No contexts found</div>
            <div className="empty-state-message">
              {filters.status || filters.support_type || filters.trust_level
                ? 'Try adjusting your filters'
                : 'Context entities will appear here once created'}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
