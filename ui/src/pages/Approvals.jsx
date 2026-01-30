import { useEffect, useState } from 'react';
import { useDashboardStore } from '../stores/dashboardStore';
import { formatDistanceToNow } from 'date-fns';

export default function Approvals() {
  const { approvals, fetchApprovals, approveRequest, denyRequest } = useDashboardStore();
  const [statusFilter, setStatusFilter] = useState('pending');
  const [selectedApproval, setSelectedApproval] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [modalAction, setModalAction] = useState(null);
  const [formData, setFormData] = useState({ notes: '', reason: '' });
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    fetchApprovals(statusFilter);
  }, [statusFilter, fetchApprovals]);

  const handleAction = (approval, action) => {
    setSelectedApproval(approval);
    setModalAction(action);
    setFormData({ notes: '', reason: '' });
    setShowModal(true);
  };

  const handleSubmit = async () => {
    setProcessing(true);
    if (modalAction === 'approve') {
      await approveRequest(selectedApproval.id, 'admin', formData.notes);
    } else {
      await denyRequest(selectedApproval.id, 'admin', formData.reason);
    }
    setProcessing(false);
    setShowModal(false);
    setSelectedApproval(null);
  };

  return (
    <>
      <header className="page-header">
        <h1 className="page-title">Access Approvals</h1>
        <p className="page-subtitle">Review and manage access requests from context entities</p>
      </header>

      <div className="page-content">
        {/* Status Filter */}
        <div className="filters-bar">
          <span style={{ fontSize: '13px', color: 'var(--text-muted)', marginRight: '8px' }}>Status:</span>
          {['pending', 'approved', 'denied'].map(status => (
            <button
              key={status}
              className={`filter-chip ${statusFilter === status ? 'active' : ''}`}
              onClick={() => setStatusFilter(status)}
            >
              {status}
            </button>
          ))}
        </div>

        {/* Approvals List */}
        {approvals.length > 0 ? (
          <div className="card">
            <div className="card-body" style={{ padding: 0 }}>
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Context</th>
                      <th>Request Type</th>
                      <th>Project</th>
                      <th>Trust Level</th>
                      <th>Requested</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {approvals.map(approval => (
                      <tr key={approval.id}>
                        <td>
                          <div style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                            {approval.context_chitty_id?.slice(0, 20)}...
                          </div>
                        </td>
                        <td>
                          <span className="entity-tag">
                            {approval.payload.request_type || 'access_request'}
                          </span>
                        </td>
                        <td>{approval.project_path?.split('/').pop() || 'Unknown'}</td>
                        <td>
                          <span className={`trust-badge level-${approval.trust_level}`}>
                            L{approval.trust_level}
                          </span>
                        </td>
                        <td>
                          {formatDistanceToNow(new Date(approval.timestamp), { addSuffix: true })}
                        </td>
                        <td>
                          <span className={`status-badge ${approval.payload.status}`}>
                            {approval.payload.status}
                          </span>
                        </td>
                        <td>
                          {approval.payload.status === 'pending' ? (
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button
                                className="btn btn-primary btn-sm"
                                onClick={() => handleAction(approval, 'approve')}
                              >
                                Approve
                              </button>
                              <button
                                className="btn btn-danger btn-sm"
                                onClick={() => handleAction(approval, 'deny')}
                              >
                                Deny
                              </button>
                            </div>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>
                              {approval.payload.status === 'approved'
                                ? `Approved by ${approval.payload.approved_by || 'admin'}`
                                : `Denied: ${approval.payload.denial_reason || 'No reason'}`}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="card-body">
              <div className="empty-state">
                <div className="empty-state-title">No {statusFilter} approvals</div>
                <div className="empty-state-message">
                  {statusFilter === 'pending'
                    ? 'All access requests have been processed'
                    : `No ${statusFilter} requests found`}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Action Stats */}
        <div className="stats-grid" style={{ marginTop: '24px' }}>
          <div className="stat-card" onClick={() => setStatusFilter('pending')} style={{ cursor: 'pointer' }}>
            <div className="stat-label">Pending</div>
            <div className="stat-value" style={{ color: 'var(--accent-warning)' }}>
              {approvals.filter(a => a.payload.status === 'pending').length || 0}
            </div>
          </div>
          <div className="stat-card" onClick={() => setStatusFilter('approved')} style={{ cursor: 'pointer' }}>
            <div className="stat-label">Approved (session)</div>
            <div className="stat-value" style={{ color: 'var(--accent-success)' }}>
              {statusFilter === 'approved' ? approvals.length : '-'}
            </div>
          </div>
          <div className="stat-card" onClick={() => setStatusFilter('denied')} style={{ cursor: 'pointer' }}>
            <div className="stat-label">Denied (session)</div>
            <div className="stat-value" style={{ color: 'var(--accent-danger)' }}>
              {statusFilter === 'denied' ? approvals.length : '-'}
            </div>
          </div>
        </div>
      </div>

      {/* Action Modal */}
      {showModal && selectedApproval && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">
                {modalAction === 'approve' ? 'Approve Request' : 'Deny Request'}
              </h3>
              <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div style={{ background: 'var(--bg-tertiary)', padding: '16px', borderRadius: '8px', marginBottom: '20px' }}>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Context</div>
                <div style={{ fontFamily: 'monospace', fontSize: '13px' }}>
                  {selectedApproval.context_chitty_id}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '12px', marginBottom: '4px' }}>
                  Project
                </div>
                <div>{selectedApproval.project_path}</div>
                {selectedApproval.payload.requested_trust_level && (
                  <>
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '12px', marginBottom: '4px' }}>
                      Requested Trust Level
                    </div>
                    <div>
                      <span className={`trust-badge level-${selectedApproval.payload.requested_trust_level}`}>
                        Level {selectedApproval.payload.requested_trust_level}
                      </span>
                    </div>
                  </>
                )}
              </div>

              {modalAction === 'approve' ? (
                <div className="form-group">
                  <label className="form-label">Notes (optional)</label>
                  <textarea
                    className="form-input"
                    rows="3"
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder="Add any notes about this approval..."
                  />
                </div>
              ) : (
                <div className="form-group">
                  <label className="form-label">Denial Reason *</label>
                  <textarea
                    className="form-input"
                    rows="3"
                    value={formData.reason}
                    onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                    placeholder="Why is this request being denied?"
                  />
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>
                Cancel
              </button>
              <button
                className={`btn ${modalAction === 'approve' ? 'btn-primary' : 'btn-danger'}`}
                onClick={handleSubmit}
                disabled={processing || (modalAction === 'deny' && !formData.reason)}
              >
                {processing ? 'Processing...' : modalAction === 'approve' ? 'Approve' : 'Deny'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
