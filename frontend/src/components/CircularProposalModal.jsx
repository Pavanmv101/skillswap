/**
 * CircularProposalModal.jsx — Phase 6 / F-04 Stage 1
 * Confirmation modal for proposing a 3-way circular exchange.
 * Submits POST /api/circular/proposals with the exact backend payload.
 */
import { useState }    from 'react'
import api             from '../api/axios'
import Avatar          from './Avatar'
import { useAuth }     from '../context/AuthContext'
import { useToast }    from '../context/ToastContext'

/**
 * Props:
 *   cycle     – cycle object from GET /api/recommendations/circular
 *   onClose   – callback to dismiss the modal
 *   onSuccess – optional callback invoked when proposal is successfully sent
 */
export default function CircularProposalModal({ cycle, onClose, onSuccess }) {
  const { user }     = useAuth()
  const { addToast } = useToast()

  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [sent,    setSent]    = useState(false)
  const [conflictId, setConflictId] = useState(null)

  const currentUserId = user?._id || user?.id
  const currentUserIdStr = currentUserId ? String(currentUserId) : ''

  // Determine what the current user teaches and learns in this cycle.
  const teachingLeg = cycle.legs.find(l => String(l.teacher?._id || l.teacher) === currentUserIdStr)
  const learningLeg = cycle.legs.find(l => String(l.learner?._id || l.learner) === currentUserIdStr)

  async function handleSubmit() {
    setError('')
    setConflictId(null)
    setLoading(true)

    try {
      const payload = {
        legs: cycle.legs.map(leg => ({
          teacher:      leg.teacher._id,
          learner:      leg.learner._id,
          skill:        leg.skill,
          category:     leg.category,
          teacherLevel: leg.teacherLevel,
          learnerLevel: leg.learnerLevel ?? null,
        })),
        participants: cycle.legs.map(leg => leg.teacher._id),
        cycleScore:   cycle.cycleScore,
      }

      await api.post('/circular/proposals', payload)
      setSent(true)
      addToast('Circular exchange proposal sent! 🚀', 'success')
      if (onSuccess) onSuccess()
    } catch (err) {
      const status = err.response?.status
      const data   = err.response?.data

      if (status === 409) {
        setConflictId(data?.proposalId || null)
        setError(data?.message || 'A proposal for this cycle already exists.')
      } else {
        setError(data?.message || 'Failed to send proposal. Please try again.')
      }
      addToast(err.response?.data?.message || 'Proposal failed', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: '520px' }}>

        {/* ── Success state ── */}
        {sent ? (
          <div style={{ textAlign: 'center', padding: '1rem 0' }}>
            <div style={{ fontSize: '3rem', marginBottom: '.75rem' }}>🎉</div>
            <h3>Circular Proposal Sent!</h3>
            <p style={{ color: 'var(--text-muted)', margin: '.75rem 0 1.5rem', lineHeight: 1.5 }}>
              Your 3-way exchange proposal has been sent to all participants.
              You'll be notified when they respond.
            </p>
            <button className="btn btn-primary btn-block" onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
          <>
            {/* ── Header ── */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '1.25rem' }}>
              <div style={{ fontSize: '1.6rem' }}>🔄</div>
              <div>
                <h3 style={{ margin: 0 }}>Propose 3-Way Exchange</h3>
                <p style={{ margin: 0, fontSize: '.82rem', color: 'var(--text-muted)' }}>
                  Cycle Score: {Math.round(cycle.cycleScore)}%
                </p>
              </div>
            </div>

            {/* ── Error / Conflict ── */}
            {error && (
              <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
                ⚠ {error}
                {conflictId && (
                  <div style={{ marginTop: '0.4rem', fontSize: '0.8rem' }}>
                    Existing proposal ID: <code>{conflictId}</code>
                  </div>
                )}
              </div>
            )}

            {/* ── Your role summary ── */}
            {teachingLeg && learningLeg && (
              <div
                style={{
                  padding: '0.75rem',
                  borderRadius: '8px',
                  background: '#faf5ff',
                  border: '1px solid #c084fc33',
                  marginBottom: '1rem',
                  fontSize: '0.88rem',
                  lineHeight: 1.5,
                }}
              >
                <div>
                  <strong>You will teach</strong>{' '}
                  <span className="tag tag-highlight" style={{ fontSize: '0.78rem' }}>{teachingLeg.skill}</span>{' '}
                  to <strong>{teachingLeg.learner.name}</strong>
                </div>
                <div style={{ marginTop: '0.3rem' }}>
                  <strong>You will learn</strong>{' '}
                  <span className="tag tag-highlight" style={{ fontSize: '0.78rem' }}>{learningLeg.skill}</span>{' '}
                  from <strong>{learningLeg.teacher.name}</strong>
                </div>
              </div>
            )}

            {/* ── All three legs ── */}
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.5rem', color: 'var(--text-muted)' }}>
                Exchange Legs
              </div>
              {cycle.legs.map((leg, i) => (
                <div
                  key={leg.legIndex ?? i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    padding: '0.5rem 0.65rem',
                    borderRadius: '6px',
                    background: '#f9fafb',
                    border: '1px solid var(--border)',
                    marginBottom: i < cycle.legs.length - 1 ? '0.4rem' : 0,
                    flexWrap: 'wrap',
                  }}
                >
                  <Avatar name={leg.teacher.name} size={26} />
                  <span style={{ fontSize: '0.82rem', fontWeight: 500 }}>{leg.teacher.name}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>teaches</span>
                  <span className="tag tag-highlight" style={{ fontSize: '0.75rem' }}>
                    {leg.skill}
                    <small style={{ opacity: 0.7, marginLeft: '0.2rem' }}>
                      ({leg.teacherLevel}{leg.learnerLevel ? ` → ${leg.learnerLevel}` : ''})
                    </small>
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>to</span>
                  <Avatar name={leg.learner.name} size={26} />
                  <span style={{ fontSize: '0.82rem', fontWeight: 500 }}>{leg.learner.name}</span>
                </div>
              ))}
            </div>

            {/* ── Actions ── */}
            <div style={{ display: 'flex', gap: '.5rem', marginTop: '1.25rem' }}>
              <button
                type="button"
                className="btn btn-primary shadow-glow"
                style={{ flex: 1 }}
                disabled={loading}
                onClick={handleSubmit}
              >
                {loading ? 'Sending…' : '🚀 Send Proposal'}
              </button>
              <button
                type="button"
                className="btn btn-muted"
                onClick={onClose}
                disabled={loading}
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
