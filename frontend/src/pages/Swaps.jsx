import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../api/axios'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import Spinner from '../components/Spinner'
import RatingModal from '../components/RatingModal'
import ScheduleModal from '../components/ScheduleModal'
import Avatar from '../components/Avatar'

const STATUS_COLORS = {
  pending:   { bg: '#fffbeb', text: '#b45309', border: '#fde68a' },
  accepted:  { bg: '#ecfdf5', text: '#065f46', border: '#a7f3d0' },
  rejected:  { bg: '#fef2f2', text: '#991b1b', border: '#fecaca' },
  cancelled: { bg: '#f1f5f9', text: '#475569', border: '#e2e8f0' },
  completed: { bg: '#eff6ff', text: '#1e40af', border: '#bfdbfe' },
}

export default function Swaps() {
  const { user } = useAuth()
  const { addToast } = useToast()
  const [swaps, setSwaps]     = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab]         = useState('received')
  const [ratingTarget, setRatingTarget]     = useState(null)
  const [scheduleTarget, setScheduleTarget] = useState(null)
  const [actionLoading, setActionLoading]   = useState(null)
  const [error, setError] = useState('')

  async function loadSwaps() {
    try {
      const { data } = await api.get('/swap')
      setSwaps(data || [])
    } catch (err) {
      setError('Failed to load swaps')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSwaps()
  }, [])

  // Action handlers
  async function handleAction(id, action, body = {}) {
    setActionLoading(id + action)
    try {
      await api.put(`/swap/${id}/${action}`, body)
      addToast(`Swap status updated to ${action}ed! ✨`, 'success')
      await loadSwaps()
    } catch (err) {
      const msg = err.response?.data?.message || `Failed to ${action} swap`
      addToast(msg, 'error')
    } finally {
      setActionLoading(null)
    }
  }

  const uid = user?.id

  // Counts for tabs
  const receivedCount = swaps.filter(s => (s.toUser?._id === uid || s.toUser === uid) && s.status === 'pending').length
  const sentCount     = swaps.filter(s => (s.fromUser?._id === uid || s.fromUser === uid) && s.status === 'pending').length
  const activeCount   = swaps.filter(s => s.status === 'accepted').length
  const doneCount     = swaps.filter(s => s.status === 'completed').length

  const filtered = swaps.filter(s => {
    const from = s.fromUser?._id || s.fromUser
    const to   = s.toUser?._id || s.toUser
    if (tab === 'received')  return to === uid && s.status === 'pending'
    if (tab === 'sent')      return from === uid && s.status === 'pending'
    if (tab === 'active')    return s.status === 'accepted'
    if (tab === 'completed') return s.status === 'completed'
    return true
  })

  if (loading) return <Spinner message="Loading your swap center…" />

  return (
    <div className="page">
      <div className="page-header-flex">
        <div>
          <h2 className="page-title">Skill Barter Hub</h2>
          <p className="page-sub">
            Track your incoming proposals, active video calls, and completed sessions.
          </p>
        </div>
      </div>

      {error && <div className="alert alert-error">⚠ {error}</div>}

      {/* Modern Tab Bar */}
      <div className="tabs-bar">
        <button
          className={`tab-btn ${tab === 'received' ? 'tab-btn-active' : ''}`}
          onClick={() => setTab('received')}
        >
          Received
          {receivedCount > 0 && <span className="tab-counter">{receivedCount}</span>}
        </button>
        <button
          className={`tab-btn ${tab === 'sent' ? 'tab-btn-active' : ''}`}
          onClick={() => setTab('sent')}
        >
          Sent
          {sentCount > 0 && <span className="tab-counter">{sentCount}</span>}
        </button>
        <button
          className={`tab-btn ${tab === 'active' ? 'tab-btn-active' : ''}`}
          onClick={() => setTab('active')}
        >
          Active Sessions
          {activeCount > 0 && <span className="tab-counter tab-counter-active">{activeCount}</span>}
        </button>
        <button
          className={`tab-btn ${tab === 'completed' ? 'tab-btn-active' : ''}`}
          onClick={() => setTab('completed')}
        >
          Completed
          {doneCount > 0 && <span className="tab-counter">{doneCount}</span>}
        </button>
      </div>

      {/* Empty State */}
      {filtered.length === 0 && (
        <div className="empty-card" style={{ marginTop: '1.5rem' }}>
          <div className="empty-icon">
            {tab === 'received' && '📬'}
            {tab === 'sent' && '🚀'}
            {tab === 'active' && '🎥'}
            {tab === 'completed' && '🏆'}
          </div>
          <h3>No {tab} swaps</h3>
          <p style={{ maxWidth: 460, margin: '.5rem auto 1.5rem', color: 'var(--text-muted)' }}>
            {tab === 'received' && 'You have no pending incoming proposals. Connect with peers from the Matches page.'}
            {tab === 'sent' && 'You have not sent any pending requests. Browse candidates and propose a barter.'}
            {tab === 'active' && 'No active swaps yet. Once a proposal is accepted, your live video room will show up here.'}
            {tab === 'completed' && 'No completed sessions yet. Finish an active session to rate and leave reviews.'}
          </p>
          <Link to="/matches" className="btn btn-primary shadow-glow">
            Find Matches →
          </Link>
        </div>
      )}

      {/* Swaps List */}
      <div className="card-list" style={{ marginTop: '1.5rem' }}>
        {filtered.map(s => {
          const isSender = (s.fromUser?._id || s.fromUser) === uid
          const partner  = isSender ? s.toUser : s.fromUser
          const styleCfg = STATUS_COLORS[s.status] || STATUS_COLORS.cancelled

          return (
            <div className="card swap-card" key={s._id}>
              <div className="swap-card-main">
                <div className="swap-partner-header">
                  <Avatar name={partner?.name} size={48} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem' }}>
                      <Link to={`/user/${partner?._id}`} className="card-name" style={{ fontSize: '1.1rem' }}>
                        {partner?.name || 'Peer'}
                      </Link>
                      <span
                        className="badge"
                        style={{
                          background: styleCfg.bg,
                          color: styleCfg.text,
                          border: `1px solid ${styleCfg.border}`,
                          textTransform: 'capitalize'
                        }}
                      >
                        {s.status}
                      </span>
                    </div>

                    {/* Barter Flow */}
                    <div className="swap-barter-flow">
                      <div className="swap-flow-pill">
                        <span className="flow-pill-label">{isSender ? 'You Teach' : 'They Teach'}:</span>
                        <strong>{s.offeredSkill}</strong>
                      </div>
                      <span className="swap-arrow">⇄</span>
                      <div className="swap-flow-pill">
                        <span className="flow-pill-label">{isSender ? 'You Learn' : 'They Learn'}:</span>
                        <strong>{s.wantedSkill}</strong>
                      </div>
                    </div>

                    {/* Schedule / Compatibility metadata */}
                    <div className="swap-meta-row">
                      {s.scheduledAt && (
                        <span className="meta-pill meta-schedule">
                          📅 {new Date(s.scheduledAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                        </span>
                      )}
                      {s.compatibilityScore > 0 && (
                        <span className="meta-pill">
                          ⚡ {s.compatibilityScore}% Compatibility
                        </span>
                      )}
                      <span className="meta-pill" style={{ color: 'var(--text-muted)' }}>
                        Created {new Date(s.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="swap-actions-row">
                  {/* Received pending -> Accept or Reject */}
                  {tab === 'received' && (
                    <>
                      <button
                        className="btn btn-primary btn-sm shadow-glow"
                        disabled={actionLoading === s._id + 'accept'}
                        onClick={() => handleAction(s._id, 'accept')}
                      >
                        {actionLoading === s._id + 'accept' ? 'Accepting…' : 'Accept Swap'}
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        disabled={actionLoading === s._id + 'reject'}
                        onClick={() => handleAction(s._id, 'reject')}
                      >
                        Decline
                      </button>
                    </>
                  )}

                  {/* Sent pending -> Cancel */}
                  {tab === 'sent' && (
                    <button
                      className="btn btn-muted btn-sm"
                      disabled={actionLoading === s._id + 'cancel'}
                      onClick={() => handleAction(s._id, 'cancel')}
                    >
                      Cancel Request
                    </button>
                  )}

                  {/* Active -> Video Call, Schedule, Complete */}
                  {tab === 'active' && (
                    <>
                      {s.roomId && (
                        <Link to={`/room/${s.roomId}`} className="btn btn-primary btn-sm shadow-glow">
                          🎥 Join Video Call
                        </Link>
                      )}
                      <button
                        className="btn btn-muted btn-sm"
                        onClick={() => setScheduleTarget(s)}
                      >
                        📅 {s.scheduledAt ? 'Reschedule' : 'Set Schedule'}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={actionLoading === s._id + 'complete'}
                        onClick={() => handleAction(s._id, 'complete')}
                      >
                        ✅ Mark Completed
                      </button>
                    </>
                  )}

                  {/* Completed -> Rate */}
                  {tab === 'completed' && (
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => setRatingTarget(s)}
                    >
                      ⭐ Write Review / Rate
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Modals */}
      {ratingTarget && (
        <RatingModal
          swap={ratingTarget}
          onClose={() => { setRatingTarget(null); loadSwaps() }}
        />
      )}
      {scheduleTarget && (
        <ScheduleModal
          swap={scheduleTarget}
          onClose={() => { setScheduleTarget(null); loadSwaps() }}
        />
      )}
    </div>
  )
}
