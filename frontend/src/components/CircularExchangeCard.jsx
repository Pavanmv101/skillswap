/**
 * CircularExchangeCard.jsx — Phase 6 / F-04 Stage 2
 * Displays a 3-way circular exchange proposal, active exchange, or completed barter.
 * Supports accepting and declining invitations, viewing participant progress,
 * and displaying all three directed exchange legs.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import Avatar from './Avatar'
import Stars from './Stars'

const STATUS_CONFIG = {
  proposed:  { bg: '#fffbeb', text: '#b45309', border: '#fde68a', label: 'Proposed' },
  active:    { bg: '#ecfdf5', text: '#065f46', border: '#a7f3d0', label: 'Active Exchange' },
  completed: { bg: '#eff6ff', text: '#1e40af', border: '#bfdbfe', label: 'Completed' },
  cancelled: { bg: '#fef2f2', text: '#991b1b', border: '#fecaca', label: 'Declined / Cancelled' },
  expired:   { bg: '#f1f5f9', text: '#475569', border: '#e2e8f0', label: 'Expired' },
}

const LEG_STATUS_CONFIG = {
  pending:           { bg: '#f9fafb', text: '#6b7280', border: '#e5e7eb', label: 'Pending' },
  scheduled:         { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe', label: 'Scheduled' },
  teacher_completed: { bg: '#fef3c7', text: '#92400e', border: '#fde68a', label: 'Awaiting Confirmation' },
  completed:         { bg: '#ecfdf5', text: '#047857', border: '#a7f3d0', label: 'Completed' },
  cancelled:         { bg: '#fef2f2', text: '#b91c1c', border: '#fecaca', label: 'Cancelled' },
}

export default function CircularExchangeCard({
  exchange,
  currentUserId,
  onAccept,
  onDecline,
  onOpenSchedule,
  onOpenCompletion,
  actionLoading,
}) {
  const [showDeclineConfirm, setShowDeclineConfirm] = useState(false)
  const [declineReason, setDeclineReason] = useState('')

  const uidStr = currentUserId ? String(currentUserId) : ''
  const isInitiator = String(exchange.initiator?._id || exchange.initiator) === uidStr
  const myParticipant = exchange.participants?.find(p => String(p.user?._id || p.user) === uidStr)
  const hasUserAccepted = myParticipant?.hasAccepted === true

  const canRespond = exchange.status === 'proposed' && !hasUserAccepted && !isInitiator
  const statusCfg = STATUS_CONFIG[exchange.status] || STATUS_CONFIG.cancelled

  // Directed role for current user
  const teachingLeg = exchange.legs?.find(l => String(l.teacher?._id || l.teacher) === uidStr)
  const learningLeg = exchange.legs?.find(l => String(l.learner?._id || l.learner) === uidStr)

  // Accepted participants count
  const acceptedCount = exchange.participants?.filter(p => p.hasAccepted).length || 0

  function handleConfirmDecline() {
    if (onDecline) {
      onDecline(exchange._id, declineReason.trim() || 'Declined by participant')
      setShowDeclineConfirm(false)
    }
  }

  return (
    <div className="card swap-card" style={{ marginBottom: '1.25rem' }}>
      <div className="swap-card-main">
        {/* ── Top Header Row ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '0.85rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <span>🔄</span> 3-Way Circular Exchange
              </h3>
              <span
                className="badge"
                style={{
                  background: statusCfg.bg,
                  color: statusCfg.text,
                  border: `1px solid ${statusCfg.border}`,
                  fontWeight: 600,
                  fontSize: '0.75rem',
                }}
              >
                {statusCfg.label}
              </span>
              {exchange.cycleScore > 0 && (
                <span className="meta-pill" style={{ fontSize: '0.75rem' }}>
                  ⚡ {Math.round(exchange.cycleScore)}% Score
                </span>
              )}
            </div>

            <p style={{ margin: '0.25rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
              Initiated by <strong>{isInitiator ? 'You' : (exchange.initiator?.name || 'A peer')}</strong>
              {exchange.createdAt && ` on ${new Date(exchange.createdAt).toLocaleDateString()}`}
            </p>
          </div>

          {/* Expiry / Activated / Completed timestamps */}
          <div style={{ textAlign: 'right', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            {exchange.status === 'proposed' && exchange.expiresAt && (
              <span style={{ color: '#b45309' }}>
                ⏳ Expires {new Date(exchange.expiresAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            {exchange.status === 'active' && exchange.activatedAt && (
              <span style={{ color: '#065f46' }}>
                🚀 Activated {new Date(exchange.activatedAt).toLocaleDateString()}
              </span>
            )}
            {exchange.status === 'completed' && exchange.completedAt && (
              <span style={{ color: '#1e40af' }}>
                🏆 Completed {new Date(exchange.completedAt).toLocaleDateString()}
              </span>
            )}
            {exchange.cancelReason && (
              <div style={{ color: '#991b1b', marginTop: '0.2rem' }}>
                Reason: {exchange.cancelReason}
              </div>
            )}
          </div>
        </div>

        {/* ── Role Banner for Current User ── */}
        {teachingLeg && learningLeg && (
          <div
            style={{
              padding: '0.65rem 0.85rem',
              borderRadius: '8px',
              background: '#faf5ff',
              border: '1px solid #c084fc33',
              marginBottom: '1rem',
              fontSize: '0.84rem',
              lineHeight: 1.5,
            }}
          >
            <div>
              <strong>You Teach:</strong>{' '}
              <span className="tag tag-highlight" style={{ fontSize: '0.75rem' }}>{teachingLeg.skill}</span>{' '}
              to <strong>{teachingLeg.learner?.name}</strong>
              <span style={{ margin: '0 0.5rem', color: 'var(--text-muted)' }}>•</span>
              <strong>You Learn:</strong>{' '}
              <span className="tag tag-highlight" style={{ fontSize: '0.75rem' }}>{learningLeg.skill}</span>{' '}
              from <strong>{learningLeg.teacher?.name}</strong>
            </div>
          </div>
        )}

        {/* ── Participant Acceptance Progress (for Proposed status) ── */}
        {exchange.status === 'proposed' && (
          <div style={{ marginBottom: '1rem', background: '#f8fafc', padding: '0.65rem 0.85rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem', fontSize: '0.8rem', fontWeight: 600 }}>
              <span>Acceptance Progress:</span>
              <span style={{ color: acceptedCount === 3 ? '#059669' : '#d97706' }}>
                {acceptedCount} of 3 Accepted
              </span>
            </div>

            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
              {exchange.participants?.map((p, idx) => {
                const u = p.user
                const isMe = String(u?._id || u) === uidStr
                return (
                  <div
                    key={u?._id || idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.35rem',
                      padding: '0.25rem 0.5rem',
                      borderRadius: '6px',
                      background: p.hasAccepted ? '#ecfdf5' : '#fff',
                      border: `1px solid ${p.hasAccepted ? '#a7f3d0' : '#e2e8f0'}`,
                      fontSize: '0.78rem',
                    }}
                  >
                    <Avatar name={u?.name || 'Peer'} size={20} />
                    <span style={{ fontWeight: isMe ? 600 : 400 }}>
                      {u?.name || 'Participant'} {isMe && '(You)'}
                    </span>
                    <span style={{ color: p.hasAccepted ? '#059669' : '#94a3b8', fontSize: '0.85rem', marginLeft: '0.15rem' }}>
                      {p.hasAccepted ? '✓' : '⏳'}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Directed Exchange Legs ── */}
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
            Exchange Legs ({exchange.legs?.length || 3}):
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
            {exchange.legs?.map((leg, i) => {
              const isMyTeach = String(leg.teacher?._id || leg.teacher) === uidStr
              const isMyLearn = String(leg.learner?._id || leg.learner) === uidStr
              const legStatus = LEG_STATUS_CONFIG[leg.status] || LEG_STATUS_CONFIG.pending
              const legIdx = leg.legIndex ?? i
              const isPendingProposal = leg.scheduleProposal && leg.scheduleProposal.status === 'pending_confirmation'

              return (
                <div
                  key={legIdx}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.45rem',
                    padding: '0.65rem 0.85rem',
                    borderRadius: '6px',
                    background: isMyTeach
                      ? '#ecfdf5'
                      : isMyLearn
                        ? '#eff6ff'
                        : '#f9fafb',
                    border: (isMyTeach || isMyLearn)
                      ? `1px solid ${isMyTeach ? '#059669' : '#2563eb'}33`
                      : '1px solid var(--border)',
                    fontSize: '0.82rem',
                  }}
                >
                  {/* Top row: Teacher -> Skill -> Learner + Status */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {/* Teacher */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <Avatar name={leg.teacher?.name || 'Teacher'} size={24} />
                      <span style={{ fontWeight: 600 }}>
                        {leg.teacher?.name} {isMyTeach && <span style={{ color: '#059669', fontSize: '0.72rem' }}>(You)</span>}
                      </span>
                    </div>

                    {/* Direction Arrow & Skill */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', flex: '1 1 auto', minWidth: '140px', justifyContent: 'center' }}>
                      <span style={{ color: 'var(--text-muted)' }}>teaches</span>
                      <span className="tag tag-highlight" style={{ fontSize: '0.75rem' }}>
                        {leg.skill}
                        <small style={{ opacity: 0.7, marginLeft: '0.2rem' }}>
                          ({leg.teacherLevel}{leg.learnerLevel ? ` → ${leg.learnerLevel}` : ''})
                        </small>
                      </span>
                      <span style={{ color: 'var(--text-muted)' }}>to →</span>
                    </div>

                    {/* Learner */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <Avatar name={leg.learner?.name || 'Learner'} size={24} />
                      <span style={{ fontWeight: 600 }}>
                        {leg.learner?.name} {isMyLearn && <span style={{ color: '#2563eb', fontSize: '0.72rem' }}>(You)</span>}
                      </span>
                    </div>

                    {/* Leg Status */}
                    {exchange.status !== 'proposed' && (
                      <span
                        className="badge"
                        style={{
                          marginLeft: 'auto',
                          background: legStatus.bg,
                          color: legStatus.text,
                          border: `1px solid ${legStatus.border}`,
                          fontSize: '0.7rem',
                          padding: '0.15rem 0.45rem',
                        }}
                      >
                        {legStatus.label}
                      </span>
                    )}
                  </div>

                  {/* Bottom row: Schedule details & Role-based action buttons */}
                  {exchange.status !== 'proposed' && (
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: '0.5rem',
                        paddingTop: '0.35rem',
                        borderTop: '1px dashed var(--border)',
                        fontSize: '0.78rem',
                      }}
                    >
                      {/* Schedule info & proposal pill */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {leg.scheduledAt ? (
                          <span style={{ color: '#065f46', fontWeight: 500 }}>
                            📅 {new Date(leg.scheduledAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>
                            📅 Not yet scheduled
                          </span>
                        )}

                        {isPendingProposal && (
                          <span
                            className="badge"
                            style={{
                              background: '#fffbeb',
                              color: '#b45309',
                              border: '1px solid #fde68a',
                              fontSize: '0.7rem',
                              padding: '0.15rem 0.4rem',
                            }}
                          >
                            ⏳ {leg.scheduledAt ? 'Reschedule Proposed' : 'Schedule Proposed'}
                            {isMyLearn && ' (Action Required)'}
                          </span>
                        )}
                      </div>

                      {/* Role-based actions for active exchange */}
                      {exchange.status === 'active' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginLeft: 'auto' }}>
                          {/* Teacher Actions */}
                          {isMyTeach && (
                            <>
                              {!leg.scheduledAt && !isPendingProposal && (
                                <button
                                  type="button"
                                  className="btn btn-primary btn-sm"
                                  onClick={() => onOpenSchedule && onOpenSchedule(exchange, legIdx)}
                                >
                                  📅 Schedule Session
                                </button>
                              )}
                              {isPendingProposal && (
                                <button
                                  type="button"
                                  className="btn btn-outline btn-sm"
                                  onClick={() => onOpenSchedule && onOpenSchedule(exchange, legIdx)}
                                >
                                  ✏️ Edit Proposal
                                </button>
                              )}
                              {leg.scheduledAt && !isPendingProposal && leg.status !== 'teacher_completed' && leg.status !== 'completed' && (
                                <button
                                  type="button"
                                  className="btn btn-outline btn-sm"
                                  onClick={() => onOpenSchedule && onOpenSchedule(exchange, legIdx)}
                                >
                                  🔄 Reschedule
                                </button>
                              )}
                              {leg.status === 'scheduled' && (
                                <button
                                  type="button"
                                  className="btn btn-primary btn-sm shadow-glow"
                                  onClick={() => onOpenCompletion && onOpenCompletion(exchange, legIdx)}
                                >
                                  🎓 Mark Completed
                                </button>
                              )}
                              {leg.status === 'teacher_completed' && (
                                <button
                                  type="button"
                                  className="btn btn-muted btn-sm"
                                  onClick={() => onOpenCompletion && onOpenCompletion(exchange, legIdx)}
                                >
                                  ⏳ Awaiting Confirmation
                                </button>
                              )}
                              {leg.status === 'completed' && (
                                <span style={{ color: '#047857', fontWeight: 600, fontSize: '0.78rem' }}>
                                  ✅ Leg Completed
                                </span>
                              )}
                            </>
                          )}

                          {/* Learner Actions */}
                          {isMyLearn && (
                            <>
                              {isPendingProposal && (
                                <button
                                  type="button"
                                  className="btn btn-primary btn-sm shadow-glow"
                                  onClick={() => onOpenSchedule && onOpenSchedule(exchange, legIdx)}
                                >
                                  🔔 Review Schedule
                                </button>
                              )}
                              {leg.status === 'teacher_completed' && (
                                <button
                                  type="button"
                                  className="btn btn-primary btn-sm shadow-glow"
                                  onClick={() => onOpenCompletion && onOpenCompletion(exchange, legIdx)}
                                >
                                  ⭐ Confirm Completion
                                </button>
                              )}
                              {leg.scheduledAt && !isPendingProposal && leg.status !== 'teacher_completed' && leg.status !== 'completed' && (
                                <button
                                  type="button"
                                  className="btn btn-outline btn-sm"
                                  onClick={() => onOpenSchedule && onOpenSchedule(exchange, legIdx)}
                                >
                                  📅 View Schedule
                                </button>
                              )}
                              {leg.status === 'completed' && (
                                <span style={{ color: '#047857', fontWeight: 600, fontSize: '0.78rem' }}>
                                  ✅ Leg Completed
                                </span>
                              )}
                              {!leg.scheduledAt && !isPendingProposal && (
                                <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', fontStyle: 'italic' }}>
                                  Awaiting teacher proposal
                                </span>
                              )}
                            </>
                          )}

                          {/* Observer completion view */}
                          {!isMyTeach && !isMyLearn && leg.status === 'completed' && (
                            <span style={{ color: '#047857', fontWeight: 600, fontSize: '0.78rem' }}>
                              ✅ Leg Completed
                            </span>
                          )}

                          {/* Join Video Call (Authorized participants: teacher or learner) */}
                          {(isMyTeach || isMyLearn) && leg.roomId && (leg.status === 'scheduled' || leg.scheduledAt) && (
                            <Link
                              to={`/room/${leg.roomId}`}
                              className="btn btn-primary btn-sm shadow-glow"
                              style={{ padding: '0.2rem 0.55rem', fontSize: '0.75rem' }}
                            >
                              🎥 Join Call
                            </Link>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Status Messages & Action Bar ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border)' }}>
          {/* Status notes */}
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            {exchange.status === 'proposed' && isInitiator && (
              <span>🚀 You initiated this exchange. Waiting for invitees to accept.</span>
            )}
            {exchange.status === 'proposed' && !isInitiator && hasUserAccepted && (
              <span style={{ color: '#059669', fontWeight: 500 }}>
                ✅ You have accepted this invitation. Waiting for other participant(s) to accept.
              </span>
            )}
            {exchange.status === 'active' && (
              <span>✨ Exchange is active. Independent leg scheduling and sessions are underway.</span>
            )}
            {exchange.status === 'completed' && (
              <span style={{ color: '#1e40af', fontWeight: 500 }}>
                🏆 All 3 exchange legs have been completed and learner-confirmed!
              </span>
            )}
          </div>

          {/* Response Actions (Accept / Decline) */}
          {canRespond && !showDeclineConfirm && (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn btn-primary btn-sm shadow-glow"
                disabled={actionLoading === exchange._id + 'accept' || actionLoading === exchange._id + 'decline'}
                onClick={() => onAccept && onAccept(exchange._id)}
              >
                {actionLoading === exchange._id + 'accept' ? 'Accepting…' : '✅ Accept Invitation'}
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={actionLoading === exchange._id + 'accept' || actionLoading === exchange._id + 'decline'}
                onClick={() => setShowDeclineConfirm(true)}
              >
                Decline
              </button>
            </div>
          )}

          {/* Decline Confirmation Prompt */}
          {canRespond && showDeclineConfirm && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', marginTop: '0.5rem', background: '#fef2f2', padding: '0.5rem', borderRadius: '6px' }}>
              <input
                type="text"
                className="form-input"
                style={{ flex: 1, fontSize: '0.8rem', padding: '0.3rem 0.5rem' }}
                placeholder="Optional reason for declining…"
                value={declineReason}
                onChange={e => setDeclineReason(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={actionLoading === exchange._id + 'decline'}
                onClick={handleConfirmDecline}
              >
                {actionLoading === exchange._id + 'decline' ? 'Declining…' : 'Confirm Decline'}
              </button>
              <button
                type="button"
                className="btn btn-muted btn-sm"
                onClick={() => setShowDeclineConfirm(false)}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
