/**
 * CircularCompletionModal.jsx — Phase 6 / F-04 Stage 4
 *
 * Implements the completion and learner confirmation modal for individual legs
 * of an active 3-way Circular Skill Exchange.
 *
 * Reuses existing backend contracts:
 * - GET  /api/circular/:id/schedule (authoritative leg status & roles)
 * - PUT  /api/circular/:id/legs/:legIndex/complete (teacher marks leg complete)
 * - PUT  /api/circular/:id/legs/:legIndex/complete/confirm (learner confirms leg complete)
 *
 * Automatic Parent Finalization:
 * - When all 3 legs are confirmed completed, the backend finalizes the exchange.
 * - Frontend detects `exchangeFinalized` or `exchangeStatus === 'completed'` and displays celebration banner.
 */

import { useState, useEffect, useRef } from 'react'
import api from '../api/axios'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import Avatar from './Avatar'

export default function CircularCompletionModal({
  exchangeId,
  legIndex,
  onClose,
  onCompletionUpdated,
}) {
  const { user } = useAuth()
  const { addToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [parentFinalized, setParentFinalized] = useState(false)

  const [legData, setLegData] = useState(null)
  const [notes, setNotes] = useState('')

  const isMountedRef = useRef(true)

  const fetchLegStatus = async () => {
    if (!exchangeId || legIndex === undefined || legIndex === null) return
    setLoading(true)
    setError('')
    try {
      const res = await api.get(`/circular/${exchangeId}/schedule`)
      if (!isMountedRef.current) return
      const targetLeg = res.data?.legs?.find(l => l.legIndex === legIndex) || res.data?.legs?.[legIndex]
      if (targetLeg) {
        setLegData(targetLeg)
        if (res.data?.status === 'completed') {
          setParentFinalized(true)
        }
      } else {
        setError('Leg not found in this circular exchange.')
      }
    } catch (err) {
      if (!isMountedRef.current) return
      const msg = err.response?.data?.message || 'Failed to load leg completion status'
      setError(msg)
      addToast(msg, 'error')
    } finally {
      if (isMountedRef.current) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    isMountedRef.current = true
    fetchLegStatus()
    return () => {
      isMountedRef.current = false
    }
  }, [exchangeId, legIndex])

  const teacher = legData?.teacher
  const learner = legData?.learner
  const myRole = legData?.myRole || 'observer'
  const legStatus = legData?.status

  // Teacher marks leg complete
  const handleTeacherComplete = async (e) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      const res = await api.put(`/circular/${exchangeId}/legs/${legIndex}/complete`, {
        notes: notes.trim(),
      })
      const msg = res.data?.message || 'Leg marked as completed! Awaiting learner confirmation. 🎓'
      setSuccessMessage(msg)
      addToast(msg, 'success')
      setNotes('')
      await fetchLegStatus()
      if (onCompletionUpdated) onCompletionUpdated()
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to mark leg completed'
      setError(msg)
      addToast(msg, 'error')
    } finally {
      if (isMountedRef.current) {
        setSubmitting(false)
      }
    }
  }

  // Learner confirms leg completion
  const handleLearnerConfirm = async (e) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      const res = await api.put(`/circular/${exchangeId}/legs/${legIndex}/complete/confirm`, {
        notes: notes.trim(),
      })
      const isFinal = res.data?.exchangeFinalized === true || res.data?.exchangeStatus === 'completed'
      if (isFinal) {
        setParentFinalized(true)
        const finalMsg = '🏆 All 3 legs confirmed! The entire 3-way circular barter is now completed!'
        setSuccessMessage(finalMsg)
        addToast(finalMsg, 'success')
      } else {
        const msg = res.data?.message || 'Leg completion confirmed! Great job! ⭐'
        setSuccessMessage(msg)
        addToast(msg, 'success')
      }
      setNotes('')
      await fetchLegStatus()
      if (onCompletionUpdated) onCompletionUpdated()
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to confirm leg completion'
      setError(msg)
      addToast(msg, 'error')
    } finally {
      if (isMountedRef.current) {
        setSubmitting(false)
      }
    }
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 580, maxHeight: '90vh', overflowY: 'auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span>🎓</span> Leg {legIndex + 1} Completion: {legData?.skill || 'Exchange Leg'}
            </h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Mutual Learner-Confirmed Barter Completion
            </span>
          </div>
          <button
            type="button"
            className="btn btn-muted btn-sm"
            onClick={onClose}
            style={{ borderRadius: '50%', width: 32, height: 32, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            ✕
          </button>
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ padding: '2.5rem 0', textAlign: 'center', color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 1rem' }} />
            <p>Loading authoritative leg completion state…</p>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="alert alert-error" style={{ marginBottom: '1rem', fontSize: '0.85rem' }}>
            ⚠️ {error}
          </div>
        )}

        {/* Success Alert */}
        {successMessage && (
          <div className="alert alert-success" style={{ marginBottom: '1rem', fontSize: '0.85rem' }}>
            ✅ {successMessage}
          </div>
        )}

        {/* Parent Finalized Celebration Banner */}
        {parentFinalized && (
          <div
            style={{
              padding: '1rem',
              borderRadius: '8px',
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              marginBottom: '1.25rem',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🏆</div>
            <h3 style={{ margin: '0 0 0.25rem', color: '#1e40af' }}>Exchange Fully Finalized!</h3>
            <p style={{ margin: 0, fontSize: '0.85rem', color: '#1e3a8a' }}>
              All 3 exchange legs have been completed and confirmed by their respective learners.
              Credits and reliability ratings have been awarded to all participants!
            </p>
          </div>
        )}

        {!loading && legData && (
          <>
            {/* Leg Information Card */}
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '0.85rem 1rem',
                marginBottom: '1.25rem',
                fontSize: '0.85rem',
              }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '0.25rem' }}>
                    Teacher
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Avatar name={teacher?.name || 'Teacher'} size={24} />
                    <span style={{ fontWeight: 600 }}>
                      {teacher?.name} {myRole === 'teacher' && <span style={{ color: '#059669', fontSize: '0.72rem' }}>(You)</span>}
                    </span>
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '0.25rem' }}>
                    Learner
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Avatar name={learner?.name || 'Learner'} size={24} />
                    <span style={{ fontWeight: 600 }}>
                      {learner?.name} {myRole === 'learner' && <span style={{ color: '#2563eb', fontSize: '0.72rem' }}>(You)</span>}
                    </span>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: '0.75rem', paddingTop: '0.5rem', borderTop: '1px dashed var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div>
                  Skill: <strong className="tag tag-highlight" style={{ fontSize: '0.75rem' }}>{legData.skill}</strong>
                  {legData.scheduledAt && (
                    <span style={{ marginLeft: '0.75rem', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                      📅 Session: {new Date(legData.scheduledAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                    </span>
                  )}
                </div>
                <span
                  className="badge"
                  style={{
                    textTransform: 'capitalize',
                    fontSize: '0.72rem',
                    background: legStatus === 'completed' ? '#ecfdf5' : legStatus === 'teacher_completed' ? '#fef3c7' : '#eff6ff',
                    color: legStatus === 'completed' ? '#047857' : legStatus === 'teacher_completed' ? '#92400e' : '#1d4ed8',
                    border: `1px solid ${legStatus === 'completed' ? '#a7f3d0' : legStatus === 'teacher_completed' ? '#fde68a' : '#bfdbfe'}`,
                  }}
                >
                  {legStatus === 'teacher_completed' ? 'Awaiting Learner Confirmation' : legStatus?.replace('_', ' ')}
                </span>
              </div>
            </div>

            {/* ── ALREADY FULLY COMPLETED VIEW ── */}
            {legStatus === 'completed' && (
              <div
                style={{
                  padding: '0.85rem 1rem',
                  borderRadius: '8px',
                  background: '#ecfdf5',
                  border: '1px solid #a7f3d0',
                  marginBottom: '1rem',
                  fontSize: '0.85rem',
                  color: '#065f46',
                }}
              >
                <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.35rem', marginBottom: '0.25rem' }}>
                  <span>✅</span> Leg Successfully Completed & Confirmed!
                </div>
                <div style={{ fontSize: '0.8rem', lineHeight: 1.5 }}>
                  {legData.completedAt && (
                    <div>Confirmed on {new Date(legData.completedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.</div>
                  )}
                  <div>Reliability points and credit have been attributed to {teacher?.name}.</div>
                </div>
              </div>
            )}

            {/* ── TEACHER INTERACTION ── */}
            {myRole === 'teacher' && legStatus !== 'completed' && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem', marginTop: '0.5rem' }}>
                {legStatus === 'scheduled' && (
                  <form onSubmit={handleTeacherComplete}>
                    <h4 style={{ margin: '0 0 0.35rem', fontSize: '0.95rem' }}>
                      🎓 Mark Session as Completed
                    </h4>
                    <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0 0 1rem', lineHeight: 1.4 }}>
                      Finished teaching {legData.skill} to {learner?.name}? Mark the session completed.
                      <strong style={{ display: 'block', marginTop: '0.25rem', color: 'var(--text-main)' }}>
                        ℹ️ Note: Confirmation from {learner?.name} is required to officially complete this leg.
                      </strong>
                    </p>

                    <div style={{ marginBottom: '1rem' }}>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                        Session Notes / Topics Covered (Optional)
                      </label>
                      <textarea
                        className="form-input"
                        rows={2}
                        placeholder="e.g. Covered core fundamentals, hands-on exercise, and next steps…"
                        value={notes}
                        onChange={e => setNotes(e.target.value)}
                        style={{ fontSize: '0.82rem' }}
                      />
                    </div>

                    <button
                      type="submit"
                      className="btn btn-primary shadow-glow"
                      disabled={submitting}
                    >
                      {submitting ? 'Submitting…' : '🎓 Mark as Completed'}
                    </button>
                  </form>
                )}

                {legStatus === 'teacher_completed' && (
                  <div style={{ padding: '0.85rem', borderRadius: '8px', background: '#fffbeb', border: '1px solid #fde68a', fontSize: '0.85rem' }}>
                    <div style={{ fontWeight: 600, color: '#b45309', marginBottom: '0.35rem' }}>
                      ⏳ Waiting for Learner Confirmation
                    </div>
                    <p style={{ margin: 0, color: '#78350f', fontSize: '0.82rem', lineHeight: 1.4 }}>
                      You marked this leg completed on{' '}
                      {legData.teacherCompletedAt ? new Date(legData.teacherCompletedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'recently'}.
                      We have notified <strong>{learner?.name}</strong> to confirm the completion.
                    </p>
                  </div>
                )}

                {legStatus === 'active' && !legData.scheduledAt && (
                  <div style={{ padding: '0.85rem', borderRadius: '8px', background: '#f8fafc', border: '1px solid var(--border)', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    ℹ️ This leg must have a confirmed session time scheduled before it can be marked as completed.
                  </div>
                )}
              </div>
            )}

            {/* ── LEARNER INTERACTION ── */}
            {myRole === 'learner' && legStatus !== 'completed' && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem', marginTop: '0.5rem' }}>
                {legStatus === 'teacher_completed' ? (
                  <form onSubmit={handleLearnerConfirm}>
                    <h4 style={{ margin: '0 0 0.35rem', fontSize: '0.95rem', color: '#047857' }}>
                      ⭐ Confirm Session Completion
                    </h4>
                    <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0 0 1rem', lineHeight: 1.4 }}>
                      <strong>{teacher?.name}</strong> has marked your {legData.skill} session as completed.
                      Please confirm that the lesson was delivered as agreed.
                    </p>

                    <div style={{ marginBottom: '1rem' }}>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                        Confirmation Notes (Optional)
                      </label>
                      <textarea
                        className="form-input"
                        rows={2}
                        placeholder="e.g. Great session! Learned a lot about the topic…"
                        value={notes}
                        onChange={e => setNotes(e.target.value)}
                        style={{ fontSize: '0.82rem' }}
                      />
                    </div>

                    <button
                      type="submit"
                      className="btn btn-primary shadow-glow"
                      disabled={submitting}
                    >
                      {submitting ? 'Confirming…' : '⭐ Confirm Completion'}
                    </button>
                  </form>
                ) : (
                  <div style={{ padding: '0.85rem', borderRadius: '8px', background: '#f8fafc', border: '1px solid var(--border)', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                    ⏳ Once {teacher?.name || 'your teacher'} marks this session as completed after your lesson, you will be prompted to confirm completion here.
                  </div>
                )}
              </div>
            )}

            {/* ── OBSERVER VIEW ── */}
            {myRole === 'observer' && legStatus !== 'completed' && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.85rem', marginTop: '0.5rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                👁️ <em>You are an observer for this leg. Completion is coordinated directly between {teacher?.name} and {learner?.name}.</em>
              </div>
            )}

            {/* Completion History */}
            {legData.completionHistory && legData.completionHistory.length > 0 && (
              <div style={{ marginTop: '1.25rem', borderTop: '1px solid var(--border)', paddingTop: '0.75rem' }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.4rem' }}>
                  Completion Timeline ({legData.completionHistory.length}):
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  {legData.completionHistory.map((item, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: '0.35rem 0.6rem',
                        borderRadius: '6px',
                        background: '#f8fafc',
                        border: '1px solid var(--border)',
                        fontSize: '0.76rem',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span>
                        <strong>{item.status?.replace('_', ' ')}</strong>
                        {item.notes && <span style={{ color: 'var(--text-muted)', marginLeft: '0.4rem' }}>— {item.notes}</span>}
                      </span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                        {item.actionAt ? new Date(item.actionAt).toLocaleDateString() : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Footer */}
        <div style={{ marginTop: '1.25rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-muted" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
