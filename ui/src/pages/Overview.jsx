import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useDashboardStore } from '../stores/dashboardStore';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';

const TRUST_COLORS = ['#6b7280', '#ef4444', '#f97316', '#facc15', '#84cc16', '#22c55e'];

export default function Overview() {
  const { stats, fetchStats, contexts, fetchContexts } = useDashboardStore();

  useEffect(() => {
    fetchStats();
    fetchContexts();
  }, [fetchStats, fetchContexts]);

  if (!stats) {
    return (
      <div className="loading-container">
        <div className="loading-spinner" />
      </div>
    );
  }

  const trustData = stats.trust_distribution?.map(d => ({
    name: `Level ${d.trust_level}`,
    value: d.count,
    level: d.trust_level,
  })) || [];

  const typeData = stats.by_support_type?.map(d => ({
    name: d.support_type,
    count: d.count,
    avgTrust: Math.round(d.avg_trust || 0),
  })) || [];

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">ChittyID Context Overview & Observability</p>
      </header>

      <div className="page-content">
        {/* Stats Grid */}
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-label">Total Contexts</div>
            <div className="stat-value">{stats.overview.total_contexts}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Active Contexts</div>
            <div className="stat-value" style={{ color: 'var(--accent-success)' }}>
              {stats.overview.active_contexts}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Active Sessions</div>
            <div className="stat-value" style={{ color: 'var(--accent-info)' }}>
              {stats.overview.active_sessions}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Pending Approvals</div>
            <div className="stat-value" style={{ color: stats.overview.pending_approvals > 0 ? 'var(--accent-warning)' : 'var(--text-muted)' }}>
              {stats.overview.pending_approvals}
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Events (24h)</div>
            <div className="stat-value">{stats.overview.events_24h}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Dormant</div>
            <div className="stat-value" style={{ color: 'var(--accent-warning)' }}>
              {stats.overview.dormant_contexts}
            </div>
          </div>
        </div>

        {/* Charts Row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px' }}>
          {/* Trust Distribution */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">Trust Distribution</h3>
            </div>
            <div className="card-body">
              {trustData.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={trustData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {trustData.map((entry, index) => (
                        <Cell key={entry.name} fill={TRUST_COLORS[entry.level]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border-primary)',
                        borderRadius: '8px',
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="empty-state">
                  <p className="empty-state-message">No trust data available</p>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', marginTop: '16px', flexWrap: 'wrap' }}>
                {trustData.map(d => (
                  <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                    <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: TRUST_COLORS[d.level] }} />
                    <span style={{ color: 'var(--text-secondary)' }}>{d.name}: {d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Support Types */}
          <div className="card">
            <div className="card-header">
              <h3 className="card-title">By Support Type</h3>
            </div>
            <div className="card-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {typeData.map(type => (
                  <div key={type.name} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '4px',
                      background: `var(--accent-${
                        type.name === 'development' ? 'primary' :
                        type.name === 'operations' ? 'info' :
                        type.name === 'legal' ? 'warning' :
                        type.name === 'research' ? 'success' :
                        type.name === 'financial' ? 'secondary' : 'primary'
                      })`,
                    }} />
                    <span style={{ flex: 1, fontSize: '14px', textTransform: 'capitalize' }}>{type.name}</span>
                    <span style={{ fontSize: '14px', fontWeight: '600' }}>{type.count}</span>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      avg trust: {type.avgTrust}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Recent Contexts */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title">Recent Active Contexts</h3>
            <Link to="/contexts" className="btn btn-secondary btn-sm">View All</Link>
          </div>
          <div className="card-body">
            {contexts.length > 0 ? (
              <div className="entity-grid">
                {contexts.slice(0, 6).map(ctx => (
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
                          L{ctx.trust_level}
                        </span>
                        <span className="trust-score">{Math.round(ctx.trust_score)}%</span>
                      </div>
                    </div>
                    <div className="entity-info">
                      <div className="entity-name">{ctx.chitty_id?.slice(0, 20)}...</div>
                      <div className="entity-path">{ctx.project_path?.split('/').pop() || 'Unknown'}</div>
                    </div>
                    <div className="entity-stats">
                      <div className="entity-stat">
                        <div className="entity-stat-label">Sessions</div>
                        <div className="entity-stat-value">{ctx.active_sessions || 0}</div>
                      </div>
                      <div className="entity-stat">
                        <div className="entity-stat-label">Interactions</div>
                        <div className="entity-stat-value">{ctx.total_interactions || 0}</div>
                      </div>
                      <div className="entity-stat">
                        <div className="entity-stat-label">Success</div>
                        <div className="entity-stat-value">
                          {ctx.success_rate ? `${Math.round(ctx.success_rate * 100)}%` : '-'}
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <p className="empty-state-title">No contexts found</p>
                <p className="empty-state-message">Context entities will appear here once created</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
