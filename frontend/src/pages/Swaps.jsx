import { useEffect, useState, useCallback, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import api from '../api/axios'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import Spinner from '../components/Spinner'
import RatingModal from '../components/RatingModal'
import ScheduleModal from '../components/ScheduleModal'
import Avatar from '../components/Avatar'
import CircularExchangeCard from '../components/CircularExchangeCard'
import CircularScheduleModal from '../components/CircularScheduleModal'
import CircularCompletionModal from '../components/CircularCompletionModal'

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

  // High-level mode toggle: 'bilateral' | 'circular'
  const [mode, setMode] = useState('bilateral')

  // Bilateral State (preserved unchanged)
  const [swaps, setSwaps]                   = useState([])
  const [loading, setLoading]               = useState(true)
  const [tab, setTab]                       = useState('received')
  const [ratingTarget, setRatingTarget]     = useState(null)
  const [scheduleTarget, setScheduleTarget] = useState(null)
  const [actionLoading, setActionLoading]   = useState(null)
  const [error, setError]                   = useState('')

  // Circular State
  const [circularExchanges, setCircularExchanges] = useState([])
  const [circularLoading, setCircularLoading]     = useState(false)
  const [circularError, setCircularError]         = useState('')
  const [circularTab, setCircularTab]             = useState('invitations')
  const [circularScheduleTarget, setCircularScheduleTarget] = useState(null)
  const [circularCompletionTarget, setCircularCompletionTarget] = useState(null)

  const uid = user?._id || user?.id
  const uidStr = uid ? String(uid) : ''

  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => { isMountedRef.current = false }
  }, [])

  const [searchParams] = useSearchParams()

  // ── Sync Mode and Tab from URL Query Parameters ──
  useEffect(() => {
    const urlMode = searchParams.get('mode')
    const urlTab = searchParams.get('tab')
    if (urlMode === 'circular' || urlMode === 'bilateral') {
      setMode(urlMode)
    }
    if (urlMode === 'circular' && urlTab && ['invitations', 'pending', 'active', 'completed', 'history'].includes(urlTab)) {
      setCircularTab(urlTab)
    } else if (urlMode === 'bilateral' && urlTab && ['received', 'sent', 'active', 'completed', 'archived'].includes(urlTab)) {
      setTab(urlTab)
    }
  }, [searchParams])

  // ── Load Bilateral Swaps ──
  async function loadSwaps() {
    try {
      const { data } = await api.get('/swap')
      if (!isMountedRef.current) return
      setSwaps(data || [])
    } catch (err) {
      if (!isMountedRef.current) return
      setError('Failed to load swaps')
    } finally {
      if (isMountedRef.current) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    loadSwaps()
  }, [])

  // ── Load Circular Exchanges ──
  const loadCircularExchanges = useCallback(async () => {
    setCircularLoading(true)
    setCircularError('')
    try {
      const { data } = await api.get('/circular/proposals')
      if (!isMountedRef.current) return
      setCircularExchanges(data || [])
    } catch (err) {
      if (!isMountedRef.current) return
      setCircularError(err.response?.data?.message || 'Failed to load circular exchanges')
    } finally {
      if (isMountedRef.current) {
        setCircularLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    if (mode === 'circular') {
      loadCircularExchanges()
    }
  }, [mode, loadCircularExchanges])

  // ── Bilateral Action Handlers ──
  async function handleAction(id, action, body = {}) {
    setActionLoading(id + action)
    try {
      await api.put(`/swap/${id}/${action}`, body)
      const actionName = action === 'accept' ? 'accepted' : action === 'reject' ? 'declined' : action === 'complete' ? 'completed' : 'cancelled'
      addToast(`Swap ${actionName} successfully! ✨`, 'success')
      await loadSwaps()
    } catch (err) {
      const msg = err.response?.data?.message || `Failed to ${action} swap`
      addToast(msg, 'error')
    } finally {
      setActionLoading(null)
    }
  }

  // ── Circular Action Handlers ──
  async function handleAcceptCircular(id) {
    setActionLoading(id + 'accept')
    try {
      const res = await api.put(`/circular/proposals/${id}/accept`)
      const activated = res.data?.activated
      if (activated) {
        addToast('All 3 accepted! Circular exchange is now active! 🚀', 'success')
      } else {
        addToast('Invitation accepted! Awaiting final participant response. ✨', 'success')
      }
      await loadCircularExchanges()
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to accept circular invitation'
      addToast(msg, 'error')
    } finally {
      setActionLoading(null)
    }
  }

  async function handleDeclineCircular(id, reason = '') {
    setActionLoading(id + 'decline')
    try {
      await api.put(`/circular/proposals/${id}/decline`, { reason })
      addToast('Circular exchange invitation declined.', 'info')
      await loadCircularExchanges()
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to decline circular invitation'
      addToast(msg, 'error')
    } finally {
      setActionLoading(null)
    }
  }

  // ── Bilateral Counts ──
  const receivedCount = swaps.filter(s => (String(s.toUser?._id || s.toUser) === uidStr) && s.status === 'pending').length
  const sentCount     = swaps.filter(s => (String(s.fromUser?._id || s.fromUser) === uidStr) && s.status === 'pending').length
  const activeCount   = swaps.filter(s => s.status === 'accepted').length
  const doneCount     = swaps.filter(s => s.status === 'completed').length
  const archivedCount = swaps.filter(s => s.status === 'cancelled' || s.status === 'rejected').length

  const filteredBilateral = swaps.filter(s => {
    const from = String(s.fromUser?._id || s.fromUser)
    const to   = String(s.toUser?._id || s.toUser)
    if (tab === 'received')  return to === uidStr && s.status === 'pending'
    if (tab === 'sent')      return from === uidStr && s.status === 'pending'
    if (tab === 'active')    return s.status === 'accepted'
    if (tab === 'completed') return s.status === 'completed'
    if (tab === 'archived')  return s.status === 'cancelled' || s.status === 'rejected'
    return true
  })

  // ── Circular Counts & Filtering ──
  const circularInvitations = circularExchanges.filter(ex => {
    if (ex.status !== 'proposed') return false
    const isInit = String(ex.initiator?._id || ex.initiator) === uidStr
    const participant = ex.participants?.find(p => String(p.user?._id || p.user) === uidStr)
    return !isInit && participant?.hasAccepted === false
  })

  const circularPending = circularExchanges.filter(ex => {
    if (ex.status !== 'proposed') return false
    const isInit = String(ex.initiator?._id || ex.initiator) === uidStr
    const participant = ex.participants?.find(p => String(p.user?._id || p.user) === uidStr)
    return isInit || participant?.hasAccepted === true
  })

  const circularActive = circularExchanges.filter(ex => ex.status === 'active')
  const circularCompleted = circularExchanges.filter(ex => ex.status === 'completed')
  const circularHistory = circularExchanges.filter(ex => ex.status === 'cancelled' || ex.status === 'expired')

  const circularTotalNotice = circularInvitations.length + circularActive.length

  const filteredCircular = {
    invitations: circularInvitations,
    pending:     circularPending,
    active:      circularActive,
    completed:   circularCompleted,
    history:     circularHistory,
  }[circularTab] || []

  if (loading && mode === 'bilateral') return <Spinner message="Loading your swap center…" />

  return (
    <div className="page">
      <div className="page-header-flex">
        <div>
          <h2 className="page-title">Skill Barter Hub</h2>
          <p className="page-sub">
            Track your incoming proposals, active barter exchanges, and completed sessions.
          </p>
        </div>
      </div>

      {/* ── Mode Toggle: Bilateral vs Circular ── */}
      <div className="filter-pills-row" style={{ marginTop: '0.75rem', marginBottom: '1.25rem' }}>
        <button
          type="button"
          className={`filter-pill ${mode === 'bilateral' ? 'filter-pill-active' : ''}`}
          onClick={() => setMode('bilateral')}
        >
          🤝 Bilateral Swaps
          {receivedCount > 0 && (
            <span className="tab-counter" style={{ marginLeft: '0.4rem' }}>{receivedCount}</span>
          )}
        </button>

        <button
          type="button"
          className={`filter-pill ${mode === 'circular' ? 'filter-pill-active' : ''}`}
          onClick={() => setMode('circular')}
        >
          🔄 3-Way Circular Exchanges
          {circularTotalNotice > 0 && (
            <span className="tab-counter tab-counter-active" style={{ marginLeft: '0.4rem' }}>
              {circularTotalNotice}
            </span>
          )}
        </button>
      </div>

      {/* ══════════════════════════════════════════════════════════
          BILATERAL SWAPS MODE (100% Preserved)
         ══════════════════════════════════════════════════════════ */}
      {mode === 'bilateral' && (
        <>
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
            <button
              className={`tab-btn ${tab === 'archived' ? 'tab-btn-active' : ''}`}
              onClick={() => setTab('archived')}
            >
              Archived
              {archivedCount > 0 && <span className="tab-counter">{archivedCount}</span>}
            </button>
          </div>

          {/* Empty State */}
          {filteredBilateral.length === 0 && (
            <div className="empty-card" style={{ marginTop: '1.5rem' }}>
              <div className="empty-icon">
                {tab === 'received' && '📬'}
                {tab === 'sent' && '🚀'}
                {tab === 'active' && '🎥'}
                {tab === 'completed' && '🏆'}
                {tab === 'archived' && '📂'}
              </div>
              <h3>No {tab} swaps</h3>
              <p style={{ maxWidth: 460, margin: '.5rem auto 1.5rem', color: 'var(--text-muted)' }}>
                {tab === 'received' && 'You have no pending incoming proposals. Connect with peers from the Matches page.'}
                {tab === 'sent' && 'You have not sent any pending requests. Browse candidates and propose a barter.'}
                {tab === 'active' && 'No active swaps yet. Once a proposal is accepted, your live video room will show up here.'}
                {tab === 'completed' && 'No completed sessions yet. Finish an active session to rate and leave reviews.'}
                {tab === 'archived' && 'No archived, cancelled, or declined swap requests in your history.'}
              </p>
              <Link to="/matches" className="btn btn-primary shadow-glow">
                Find Matches →
              </Link>
            </div>
          )}

          {/* Swaps List */}
          <div className="card-list" style={{ marginTop: '1.5rem' }}>
            {filteredBilateral.map(s => {
              const isSender = (String(s.fromUser?._id || s.fromUser)) === uidStr
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
                              📅 {new Date(s.scheduledAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short', timeZoneName: 'short' })}
                            </span>
                          )}
                          {s.compatibilityScore > 0 && (
                            <span className="meta-pill">
                              ⚡ {s.compatibilityScore}% Compatibility
                            </span>
                          )}
                          {s.cancelReason && (
                            <span className="meta-pill" style={{ color: 'var(--danger)' }}>
                              Reason: {s.cancelReason}
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

                      {tab === 'sent' && (
                        <button
                          className="btn btn-muted btn-sm"
                          disabled={actionLoading === s._id + 'cancel'}
                          onClick={() => handleAction(s._id, 'cancel', { reason: 'Cancelled by sender' })}
                        >
                          Cancel Request
                        </button>
                      )}

                      {tab === 'active' && (
                        <>
                          {s.roomId && (
                            <Link to={`/room/${s.roomId}`} className="btn btn-primary btn-sm shadow-glow">
                              🎥 Join Video Call
                            </Link>
                          )}
                          <Link to={`/learning?swapId=${s._id}`} className="btn btn-outline btn-sm">
                            🎯 Learning Track
                          </Link>
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

                      {tab === 'completed' && (
                        <>
                          <Link to={`/learning?swapId=${s._id}`} className="btn btn-outline btn-sm">
                            🎯 Learning Track
                          </Link>
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => setRatingTarget(s)}
                          >
                            ⭐ Write Review / Rate
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Bilateral Modals */}
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
        </>
      )}

      {/* ══════════════════════════════════════════════════════════
          CIRCULAR EXCHANGES MODE (Phase 6 / F-04 Stage 2)
         ══════════════════════════════════════════════════════════ */}
      {mode === 'circular' && (
        <>
          {/* Error Banner with Retry */}
          {circularError && !circularLoading && (
            <div className="alert alert-error" style={{ marginBottom: '1.25rem' }}>
              ⚠ {circularError}
              <button
                type="button"
                className="btn btn-muted btn-sm"
                style={{ marginLeft: '0.75rem' }}
                onClick={loadCircularExchanges}
              >
                🔄 Retry
              </button>
            </div>
          )}

          {/* Circular Subtabs */}
          <div className="tabs-bar">
            <button
              className={`tab-btn ${circularTab === 'invitations' ? 'tab-btn-active' : ''}`}
              onClick={() => setCircularTab('invitations')}
            >
              Invitations
              {circularInvitations.length > 0 && (
                <span className="tab-counter tab-counter-active">{circularInvitations.length}</span>
              )}
            </button>
            <button
              className={`tab-btn ${circularTab === 'pending' ? 'tab-btn-active' : ''}`}
              onClick={() => setCircularTab('pending')}
            >
              Pending
              {circularPending.length > 0 && (
                <span className="tab-counter">{circularPending.length}</span>
              )}
            </button>
            <button
              className={`tab-btn ${circularTab === 'active' ? 'tab-btn-active' : ''}`}
              onClick={() => setCircularTab('active')}
            >
              Active Exchanges
              {circularActive.length > 0 && (
                <span className="tab-counter tab-counter-active">{circularActive.length}</span>
              )}
            </button>
            <button
              className={`tab-btn ${circularTab === 'completed' ? 'tab-btn-active' : ''}`}
              onClick={() => setCircularTab('completed')}
            >
              Completed
              {circularCompleted.length > 0 && (
                <span className="tab-counter">{circularCompleted.length}</span>
              )}
            </button>
            <button
              className={`tab-btn ${circularTab === 'history' ? 'tab-btn-active' : ''}`}
              onClick={() => setCircularTab('history')}
            >
              History
              {circularHistory.length > 0 && (
                <span className="tab-counter">{circularHistory.length}</span>
              )}
            </button>
          </div>

          {/* Loading Indicator */}
          {circularLoading && (
            <div style={{ marginTop: '2rem' }}>
              <Spinner message="Loading circular exchanges…" />
            </div>
          )}

          {/* Empty State */}
          {!circularLoading && filteredCircular.length === 0 && (
            <div className="empty-card" style={{ marginTop: '1.5rem' }}>
              <div className="empty-icon">
                {circularTab === 'invitations' && '📬'}
                {circularTab === 'pending' && '⏳'}
                {circularTab === 'active' && '🔄'}
                {circularTab === 'completed' && '🏆'}
                {circularTab === 'history' && '📂'}
              </div>
              <h3>No {circularTab} circular exchanges</h3>
              <p style={{ maxWidth: 480, margin: '.5rem auto 1.5rem', color: 'var(--text-muted)' }}>
                {circularTab === 'invitations' && 'You have no pending 3-way barter invitations waiting for your acceptance.'}
                {circularTab === 'pending' && 'You have no proposals awaiting responses from other participants.'}
                {circularTab === 'active' && 'No active 3-way circular exchanges right now. Once all 3 participants accept, your exchange becomes active.'}
                {circularTab === 'completed' && 'No completed 3-way exchanges yet. Once all three legs are confirmed, completed exchanges appear here.'}
                {circularTab === 'history' && 'No cancelled or expired circular exchange proposals in your history.'}
              </p>
              <Link to="/recommendations" className="btn btn-primary shadow-glow">
                Explore 3-Way Exchanges →
              </Link>
            </div>
          )}

          {/* Circular Exchanges List */}
          {!circularLoading && filteredCircular.length > 0 && (
            <div style={{ marginTop: '1.5rem' }}>
              {filteredCircular.map(ex => (
                <CircularExchangeCard
                  key={ex._id}
                  exchange={ex}
                  currentUserId={uidStr}
                  onAccept={handleAcceptCircular}
                  onDecline={handleDeclineCircular}
                  onOpenSchedule={(selectedEx, legIdx) => {
                    setCircularScheduleTarget({
                      exchangeId: selectedEx._id,
                      legIndex: legIdx,
                    })
                  }}
                  onOpenCompletion={(selectedEx, legIdx) => {
                    setCircularCompletionTarget({
                      exchangeId: selectedEx._id,
                      legIndex: legIdx,
                    })
                  }}
                  actionLoading={actionLoading}
                />
              ))}
            </div>
          )}

          {/* Circular Schedule Modal */}
          {circularScheduleTarget && (
            <CircularScheduleModal
              exchangeId={circularScheduleTarget.exchangeId}
              legIndex={circularScheduleTarget.legIndex}
              onClose={() => setCircularScheduleTarget(null)}
              onScheduleUpdated={async () => {
                await loadCircularExchanges()
              }}
            />
          )}

          {/* Circular Completion Modal */}
          {circularCompletionTarget && (
            <CircularCompletionModal
              exchangeId={circularCompletionTarget.exchangeId}
              legIndex={circularCompletionTarget.legIndex}
              onClose={() => setCircularCompletionTarget(null)}
              onCompletionUpdated={async () => {
                await loadCircularExchanges()
              }}
            />
          )}
        </>
      )}
    </div>
  )
}
