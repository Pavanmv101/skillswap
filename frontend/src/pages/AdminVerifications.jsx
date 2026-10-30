import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import api from '../api/axios'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import Spinner from '../components/Spinner'
import Avatar from '../components/Avatar'

const CATEGORIES = ['All', 'Programming', 'Design', 'Music', 'Academic', 'Language', 'Business', 'Other']

export default function AdminVerifications() {
  const { user } = useAuth()
  const { addToast } = useToast()
  const navigate = useNavigate()

  const [verifications, setVerifications] = useState([])
  const [counts, setCounts]               = useState({ pending: 0, verified: 0, rejected: 0 })
  const [statusFilter, setStatusFilter]   = useState('pending')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [search, setSearch]               = useState('')
  const [loading, setLoading]             = useState(true)
  const [actionLoading, setActionLoading] = useState(null)

  // Rejection modal state
  const [rejectModalItem, setRejectModalItem] = useState(null)
  const [rejectionReason, setRejectionReason] = useState('')

  // Verify administrator access
  useEffect(() => {
    if (user && user.role !== 'admin') {
      addToast('Administrator privileges required', 'error')
      navigate('/dashboard')
    }
  }, [user, navigate, addToast])

  const loadVerifications = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (statusFilter !== 'all') params.append('status', statusFilter)
      if (categoryFilter !== 'All') params.append('category', categoryFilter)
      if (search.trim()) params.append('search', search.trim())

      const { data } = await api.get(`/admin/verifications?${params.toString()}`)
      setVerifications(data.verifications || [])
      if (data.counts) setCounts(data.counts)
    } catch (err) {
      addToast('Failed to load verification queue', 'error')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, categoryFilter, search, addToast])

  useEffect(() => {
    loadVerifications()
  }, [loadVerifications])

  // Handle Approve
  async function handleApprove(item) {
    if (!window.confirm(`Approve verification for ${item.user?.name}'s skill "${item.skillName}"?`)) {
      return
    }

    setActionLoading(item._id + 'approve')
    try {
      await api.put(`/admin/verifications/${item._id}/approve`)
      addToast(`Approved "${item.skillName}" for ${item.user?.name}! 🎓`, 'success')
      loadVerifications()
    } catch (err) {
      addToast(err.response?.data?.message || 'Failed to approve', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  // Handle Reject
  async function handleConfirmReject(e) {
    e.preventDefault()
    if (!rejectionReason.trim()) {
      addToast('Please provide a mandatory reason for rejection', 'warning')
      return
    }

    setActionLoading(rejectModalItem._id + 'reject')
    try {
      await api.put(`/admin/verifications/${rejectModalItem._id}/reject`, {
        reason: rejectionReason.trim(),
      })
      addToast(`Rejected submission for "${rejectModalItem.skillName}"`, 'info')
      setRejectModalItem(null)
      setRejectionReason('')
      loadVerifications()
    } catch (err) {
      addToast(err.response?.data?.message || 'Failed to reject', 'error')
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <div className="page" style={{ maxWidth: 1040 }}>
      <div className="page-header-flex">
        <div>
          <div className="auth-brand-badge" style={{ marginBottom: '.5rem' }}>
            <span>🛡️ Administrator Portal</span>
          </div>
          <h2 className="page-title">Skill Verification Authority</h2>
          <p className="page-sub">
            Review student credentials, inspect verified repository repositories, and approve trusted platform badges.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs-bar" style={{ marginBottom: '1.25rem' }}>
        <button
          className={`tab-btn ${statusFilter === 'pending' ? 'tab-btn-active' : ''}`}
          onClick={() => setStatusFilter('pending')}
        >
          Pending Review
          {counts.pending > 0 && <span className="tab-counter tab-counter-active">{counts.pending}</span>}
        </button>
        <button
          className={`tab-btn ${statusFilter === 'verified' ? 'tab-btn-active' : ''}`}
          onClick={() => setStatusFilter('verified')}
        >
          Verified History
          <span className="tab-counter">{counts.verified}</span>
        </button>
        <button
          className={`tab-btn ${statusFilter === 'rejected' ? 'tab-btn-active' : ''}`}
          onClick={() => setStatusFilter('rejected')}
        >
          Rejected
          <span className="tab-counter">{counts.rejected}</span>
        </button>
        <button
          className={`tab-btn ${statusFilter === 'all' ? 'tab-btn-active' : ''}`}
          onClick={() => setStatusFilter('all')}
        >
          All Applications
        </button>
      </div>

      {/* Filters & Search Bar */}
      <div className="search-form-container" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap' }}>
          <div className="search-input-wrapper" style={{ flex: 1, minWidth: 260 }}>
            <span className="search-icon">🔍</span>
            <input
              className="form-input search-input"
              placeholder="Search by student name, email, or skill name..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button type="button" className="search-clear-btn" onClick={() => setSearch('')}>
                ✕
              </button>
            )}
          </div>

          <select
            className="form-select"
            style={{ width: 'auto', minWidth: 160 }}
            value={categoryFilter}
            onChange={e => setCategoryFilter(e.target.value)}
          >
            {CATEGORIES.map(c => <option key={c} value={c}>Category: {c}</option>)}
          </select>
        </div>
      </div>

      {/* List */}
      {loading ? (
        <Spinner message="Loading verification submissions…" />
      ) : verifications.length === 0 ? (
        <div className="empty-card">
          <div className="empty-icon">🛡️</div>
          <h3>Queue is clear!</h3>
          <p style={{ color: 'var(--text-muted)' }}>
            No submissions found matching "{statusFilter}" in category "{categoryFilter}".
          </p>
        </div>
      ) : (
        <div className="card-list">
          {verifications.map(item => (
            <div className="card admin-verification-card" key={item._id}>
              <div className="admin-verif-top">
                <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
                  <Avatar name={item.user?.name} size={46} />
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
                      <Link to={`/user/${item.user?._id}`} className="card-name" style={{ fontSize: '1.05rem' }}>
                        {item.user?.name}
                      </Link>
                      <span className="badge badge-yellow">{item.category}</span>
                      <span className={`badge ${item.status === 'verified' ? 'badge-green' : item.status === 'rejected' ? 'badge-danger' : 'badge-yellow'}`}>
                        {item.status.toUpperCase()}
                      </span>
                    </div>
                    <div style={{ fontSize: '.78rem', color: 'var(--text-subtle)', marginTop: '.15rem' }}>
                      {item.user?.email} • Submitted {new Date(item.createdAt).toLocaleDateString([], { dateStyle: 'medium', timeStyle: 'short' })}
                    </div>
                  </div>
                </div>

                <div className="admin-verif-skill-tag">
                  Skill: <strong>{item.skillName}</strong>
                </div>
              </div>

              {/* Evidence Review Box */}
              <div className="admin-evidence-box">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.4rem' }}>
                  <span style={{ fontSize: '.76rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                    Evidence Type: <strong>{item.evidenceType}</strong>
                  </span>
                  {item.evidenceUrl && (
                    <a
                      href={item.evidenceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="link-subtle"
                      style={{ fontSize: '.8rem', display: 'inline-flex', alignItems: 'center', gap: '.3rem' }}
                    >
                      🔗 Open Submitted Evidence Link ↗
                    </a>
                  )}
                  {item.certificateFile && (
                    <a
                      href={`/api/verification/${item._id}/file`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-muted btn-sm"
                      style={{ fontSize: '.76rem' }}
                    >
                      📜 View Authorized Certificate Document
                    </a>
                  )}
                </div>

                <p style={{ margin: 0, fontSize: '.88rem', color: 'var(--text-main)', lineHeight: 1.5 }}>
                  "{item.description}"
                </p>
              </div>

              {/* Audit Trail & Actions */}
              <div className="admin-verif-footer">
                <div className="admin-audit-text">
                  {item.reviewedBy && (
                    <span>
                      Reviewed by <strong>{item.reviewedBy.name}</strong> on {new Date(item.reviewedAt).toLocaleDateString()}
                    </span>
                  )}
                  {item.rejectionReason && (
                    <div style={{ color: 'var(--danger)', marginTop: '.25rem', fontSize: '.8rem' }}>
                      Rejection Reason: "{item.rejectionReason}"
                    </div>
                  )}
                </div>

                {item.status === 'pending' && (
                  <div style={{ display: 'flex', gap: '.5rem' }}>
                    <button
                      className="btn btn-primary btn-sm shadow-glow"
                      disabled={actionLoading === item._id + 'approve'}
                      onClick={() => handleApprove(item)}
                    >
                      {actionLoading === item._id + 'approve' ? 'Approving…' : '✓ Approve & Verify'}
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      disabled={actionLoading === item._id + 'reject'}
                      onClick={() => setRejectModalItem(item)}
                    >
                      ✕ Reject
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Mandatory Rejection Reason Modal */}
      {rejectModalItem && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setRejectModalItem(null) }}>
          <div className="modal" style={{ maxWidth: 480 }}>
            <h3>Reject Verification Submission</h3>
            <p style={{ fontSize: '.86rem', color: 'var(--text-muted)', margin: '.4rem 0 1rem' }}>
              Please provide mandatory constructive feedback to <strong>{rejectModalItem.user?.name}</strong> explaining why the evidence for "{rejectModalItem.skillName}" was insufficient.
            </p>

            <form onSubmit={handleConfirmReject}>
              <div className="form-group">
                <label className="form-label">Constructive Reason <span style={{ color: 'var(--danger)' }}>★</span></label>
                <textarea
                  className="form-textarea"
                  rows={4}
                  placeholder="e.g. GitHub repository lacks commits or documentation; certificate does not display completion date or credential ID..."
                  value={rejectionReason}
                  onChange={e => setRejectionReason(e.target.value)}
                  required
                />
              </div>

              <div style={{ display: 'flex', gap: '.5rem', marginTop: '1.25rem' }}>
                <button type="submit" className="btn btn-danger" style={{ flex: 1 }} disabled={actionLoading}>
                  Confirm Rejection
                </button>
                <button type="button" className="btn btn-muted" onClick={() => setRejectModalItem(null)} disabled={actionLoading}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
