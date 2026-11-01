/**
 * CircularScheduleModal.jsx — Phase 6 / F-04 Stage 3 Part 1
 *
 * Implements scheduling, rescheduling, and review modal for an individual directed leg
 * of an active 3-way Circular Skill Exchange.
 *
 * Backend endpoints reused:
 * - GET  /api/circular/:id/schedule
 * - POST /api/circular/:id/legs/:legIndex/schedule/propose
 * - PUT  /api/circular/:id/legs/:legIndex/schedule/confirm
 * - PUT  /api/circular/:id/legs/:legIndex/schedule/reject
 *
 * Roles supported:
 * - Teacher: Propose schedule, propose reschedule, view participant timezones.
 * - Learner: Review pending proposal in both timezones, confirm schedule, reject with optional reason.
 * - Observer: View-only schedule details.
 *
 * Safety & Invariants:
 * - Stale proposalId detection (HTTP 409 handled cleanly).
 * - Confirmed schedule is preserved until learner confirms new reschedule.
 * - Canonical ISO timestamps sent to backend.
 * - Respects IANA timezone mappings for both participants.
 */

import { useState, useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import api from '../api/axios'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import Avatar from './Avatar'

function formatLocalDateTime(val) {
  if (!val) return ''
  const d = new Date(val)
  if (isNaN(d.getTime())) return ''
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hours = String(d.getHours()).padStart(2, '0')
  const mins = String(d.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hours}:${mins}`
}

function formatInTimezone(dateVal, tz, label = '') {
  if (!dateVal) return 'Not set'
  const d = new Date(dateVal)
  if (isNaN(d.getTime())) return 'Invalid date'
  try {
    const opts = {
      dateStyle: 'medium',
      timeStyle: 'short',
    }
    if (tz) opts.timeZone = tz
    const formatted = new Intl.DateTimeFormat('en-US', opts).format(d)
    return `${formatted} (${tz || label || 'Local'})`
  } catch (_) {
    return `${d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} (${label || 'Local'})`
  }
}

export default function CircularScheduleModal({
  exchangeId,
  legIndex,
  onClose,
  onScheduleUpdated,
}) {
  const { user } = useAuth()
  const { addToast } = useToast()

  const [loadingSchedule, setLoadingSchedule] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  // Leg data retrieved from authoritative backend endpoint
  const [legData, setLegData] = useState(null)
  const [exchangeStatus, setExchangeStatus] = useState('active')

  // Teacher proposal state
  const [dateTime, setDateTime] = useState('')

  // Learner rejection state
  const [showRejectForm, setShowRejectForm] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  const isMountedRef = useRef(true)

  const browserTimezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    } catch (_) {
      return 'UTC'
    }
  }, [])

  // Current local time ISO string for min attribute in datetime input
  const minDateTime = useMemo(() => {
    return formatLocalDateTime(new Date())
  }, [])

  // Fetch authoritative schedule data
  const fetchSchedule = async () => {
    if (!exchangeId || legIndex === undefined || legIndex === null) return
    setLoadingSchedule(true)
    setError('')
    try {
      const res = await api.get(`/circular/${exchangeId}/schedule`)
      if (!isMountedRef.current) return
      setExchangeStatus(res.data?.status || 'active')
      const targetLeg = res.data?.legs?.find(l => l.legIndex === legIndex) || res.data?.legs?.[legIndex]
      if (targetLeg) {
        setLegData(targetLeg)
        // If there's an existing proposal or confirmed schedule, pre-populate default if teacher
        if (targetLeg.scheduleProposal?.status === 'pending_confirmation' && targetLeg.scheduleProposal.proposedTime) {
          setDateTime(formatLocalDateTime(targetLeg.scheduleProposal.proposedTime))
        } else if (targetLeg.scheduledAt) {
          setDateTime(formatLocalDateTime(targetLeg.scheduledAt))
        }
      } else {
        setError('Leg not found in this circular exchange.')
      }
    } catch (err) {
      if (!isMountedRef.current) return
      const msg = err.response?.data?.message || 'Failed to load circular schedule'
      setError(msg)
      addToast(msg, 'error')
    } finally {
      if (isMountedRef.current) {
        setLoadingSchedule(false)
      }
    }
  }

  useEffect(() => {
    isMountedRef.current = true
    fetchSchedule()
    return () => {
      isMountedRef.current = false
    }
  }, [exchangeId, legIndex])

  // Derive roles and flags
  const teacher = legData?.teacher
  const learner = legData?.learner
  const myRole = legData?.myRole || 'observer'

  const teacherTz = teacher?.timezone || browserTimezone
  const learnerTz = learner?.timezone || browserTimezone

  const proposal = legData?.scheduleProposal
  const isPendingConfirmation = proposal && proposal.status === 'pending_confirmation'
  const isReschedule = !!legData?.scheduledAt

  // Teacher submits schedule proposal
  const handleProposeSchedule = async (e) => {
    e.preventDefault()
    setError('')

    if (!dateTime) {
      setError('Please select a valid session date and time.')
      return
    }

    const pickedDate = new Date(dateTime)
    if (isNaN(pickedDate.getTime())) {
      setError('Invalid date format.')
      return
    }

    if (pickedDate <= new Date()) {
      setError('Proposed session time must be in the future.')
      addToast('Cannot schedule sessions in the past', 'warning')
      return
    }

    setSubmitting(true)
    try {
      const res = await api.post(`/circular/${exchangeId}/legs/${legIndex}/schedule/propose`, {
        scheduledTime: pickedDate.toISOString(),
      })
      addToast(res.data?.message || 'Schedule proposal submitted! 📅', 'success')
      setSuccessMessage(res.data?.message || 'Proposal submitted successfully.')
      await fetchSchedule()
      if (onScheduleUpdated) onScheduleUpdated()
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to propose session schedule'
      setError(msg)
      addToast(msg, 'error')
    } finally {
      if (isMountedRef.current) {
        setSubmitting(false)
      }
    }
  }

  // Learner confirms schedule proposal
  const handleConfirmSchedule = async () => {
    if (!proposal?.proposalId) {
      setError('Missing proposal ID. Please reload.')
      return
    }

    setError('')
    setSubmitting(true)
    try {
      const res = await api.put(`/circular/${exchangeId}/legs/${legIndex}/schedule/confirm`, {
        proposalId: proposal.proposalId,
      })
      addToast(res.data?.message || 'Session schedule confirmed! ✅', 'success')
      setSuccessMessage('Schedule confirmed! Both parties can join the session at the agreed time.')
      await fetchSchedule()
      if (onScheduleUpdated) onScheduleUpdated()
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to confirm schedule proposal'
      setError(msg)
      addToast(msg, 'error')
    } finally {
      if (isMountedRef.current) {
        setSubmitting(false)
      }
    }
  }

  // Learner rejects schedule proposal
  const handleRejectSchedule = async () => {
    if (!proposal?.proposalId) {
      setError('Missing proposal ID. Please reload.')
      return
    }

    setError('')
    setSubmitting(true)
    try {
      const res = await api.put(`/circular/${exchangeId}/legs/${legIndex}/schedule/reject`, {
        proposalId: proposal.proposalId,
        reason: rejectReason.trim(),
      })
      addToast(res.data?.message || 'Schedule proposal declined.', 'info')
      setShowRejectForm(false)
      setRejectReason('')
      await fetchSchedule()
      if (onScheduleUpdated) onScheduleUpdated()
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to decline schedule proposal'
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
      <div className="modal" style={{ maxWidth: 620, maxHeight: '90vh', overflowY: 'auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span>📅</span> Leg {legIndex + 1} Scheduling: {legData?.skill || 'Exchange Leg'}
            </h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Part of 3-Way Circular Skill Barter
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

        {/* Loading Spinner */}
        {loadingSchedule && (
          <div style={{ padding: '2.5rem 0', textAlign: 'center', color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 1rem' }} />
            <p>Loading authoritative schedule data…</p>
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

        {!loadingSchedule && legData && (
          <>
            {/* Participants & Timezone Summary Box */}
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
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                {/* Teacher Details */}
                <div>
                  <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '0.35rem' }}>
                    Teacher {myRole === 'teacher' && '(You)'}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Avatar name={teacher?.name || 'Teacher'} size={28} />
                    <div>
                      <div style={{ fontWeight: 600 }}>{teacher?.name}</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        🌐 Timezone: <code>{teacher?.timezone || 'Not configured'}</code>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Learner Details */}
                <div>
                  <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 600, marginBottom: '0.35rem' }}>
                    Learner {myRole === 'learner' && '(You)'}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Avatar name={learner?.name || 'Learner'} size={28} />
                    <div>
                      <div style={{ fontWeight: 600 }}>{learner?.name}</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        🌐 Timezone: <code>{learner?.timezone || 'Not configured'}</code>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Browser local timezone banner */}
              <div style={{ marginTop: '0.75rem', paddingTop: '0.5rem', borderTop: '1px dashed var(--border)', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                🖥️ Your browser timezone: <strong>{browserTimezone}</strong>
              </div>
            </div>

            {/* Current Confirmed Schedule Status */}
            <div
              style={{
                padding: '0.75rem 1rem',
                borderRadius: '8px',
                background: legData.scheduledAt ? '#ecfdf5' : '#f9fafb',
                border: `1px solid ${legData.scheduledAt ? '#a7f3d0' : 'var(--border)'}`,
                marginBottom: '1.25rem',
                fontSize: '0.85rem',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div>
                  <strong style={{ color: legData.scheduledAt ? '#065f46' : 'var(--text-muted)' }}>
                    {legData.scheduledAt ? '✅ Current Confirmed Session:' : '⏳ Schedule Status:'}
                  </strong>
                  <div style={{ marginTop: '0.25rem' }}>
                    {legData.scheduledAt ? (
                      <>
                        <div>• In your local time: <strong>{formatInTimezone(legData.scheduledAt, browserTimezone)}</strong></div>
                        {teacher?.timezone && teacher.timezone !== browserTimezone && (
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                            • Teacher timezone: {formatInTimezone(legData.scheduledAt, teacher.timezone)}
                          </div>
                        )}
                        {learner?.timezone && learner.timezone !== browserTimezone && (
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                            • Learner timezone: {formatInTimezone(legData.scheduledAt, learner.timezone)}
                          </div>
                        )}
                      </>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>No confirmed session yet.</span>
                    )}
                  </div>

                  {legData.scheduledAt && legData.roomId && (myRole === 'teacher' || myRole === 'learner') && (
                    <div style={{ marginTop: '0.65rem' }}>
                      <Link
                        to={`/room/${legData.roomId}`}
                        className="btn btn-primary btn-sm shadow-glow"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.78rem' }}
                      >
                        🎥 Join Video Call
                      </Link>
                    </div>
                  )}
                </div>

                {legData.status && (
                  <span
                    className="badge"
                    style={{
                      background: legData.status === 'scheduled' ? '#eff6ff' : '#f1f5f9',
                      color: legData.status === 'scheduled' ? '#1d4ed8' : '#475569',
                      border: '1px solid #bfdbfe',
                      textTransform: 'capitalize',
                      fontSize: '0.75rem',
                    }}
                  >
                    Leg: {legData.status.replace('_', ' ')}
                  </span>
                )}
              </div>
            </div>

            {/* Pending Reschedule / Proposal Notification Banner */}
            {isPendingConfirmation && (
              <div
                style={{
                  padding: '0.85rem 1rem',
                  borderRadius: '8px',
                  background: '#fffbeb',
                  border: '1px solid #fde68a',
                  marginBottom: '1.25rem',
                  fontSize: '0.85rem',
                }}
              >
                <div style={{ fontWeight: 600, color: '#b45309', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <span>⏳</span> {isReschedule ? 'Rescheduling Proposal Pending' : 'New Schedule Proposal Pending'}
                </div>
                <div style={{ color: '#78350f', lineHeight: 1.5 }}>
                  <div>
                    Proposed Time:{' '}
                    <strong>{formatInTimezone(proposal.proposedTime, browserTimezone)}</strong>
                  </div>
                  {teacher?.timezone && teacher.timezone !== browserTimezone && (
                    <div style={{ fontSize: '0.78rem', color: '#92400e' }}>
                      Teacher ({teacher.name}): {formatInTimezone(proposal.proposedTime, teacher.timezone)}
                    </div>
                  )}
                  {learner?.timezone && learner.timezone !== browserTimezone && (
                    <div style={{ fontSize: '0.78rem', color: '#92400e' }}>
                      Learner ({learner.name}): {formatInTimezone(proposal.proposedTime, learner.timezone)}
                    </div>
                  )}
                  {isReschedule && (
                    <div style={{ marginTop: '0.4rem', fontSize: '0.78rem', color: '#b45309' }}>
                      ℹ️ <em>Note: The current confirmed schedule is preserved until the learner confirms this new time.</em>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── TEACHER INTERACTION ── */}
            {myRole === 'teacher' && exchangeStatus === 'active' && (
              <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
                <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>
                  {isReschedule ? '🔄 Propose Rescheduled Time' : '📅 Propose Session Schedule'}
                </h4>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0 0 1rem', lineHeight: 1.4 }}>
                  Select the proposed date and time in your local time. Learner confirmation is required before this time is confirmed.
                </p>

                <form onSubmit={handleProposeSchedule}>
                  <div style={{ marginBottom: '1rem' }}>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '0.35rem' }}>
                      Session Date & Time ({browserTimezone})
                    </label>
                    <input
                      type="datetime-local"
                      className="form-input"
                      style={{ maxWidth: 320 }}
                      min={minDateTime}
                      value={dateTime}
                      onChange={e => setDateTime(e.target.value)}
                      required
                    />
                  </div>

                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                    <button
                      type="submit"
                      className="btn btn-primary shadow-glow"
                      disabled={submitting}
                    >
                      {submitting ? 'Submitting…' : isReschedule ? 'Submit Reschedule Proposal' : 'Propose Schedule'}
                    </button>
                    {isPendingConfirmation && (
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                        (Submitting will supersede pending proposal)
                      </span>
                    )}
                  </div>
                </form>
              </div>
            )}

            {/* ── LEARNER INTERACTION ── */}
            {myRole === 'learner' && isPendingConfirmation && (
              <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
                <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>
                  🔔 Action Required: Respond to Proposed Schedule
                </h4>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0 0 1rem', lineHeight: 1.4 }}>
                  {teacher?.name || 'Your teacher'} proposed this session time. Please confirm if you can attend, or decline with an optional note.
                </p>

                {!showRejectForm ? (
                  <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-primary shadow-glow"
                      disabled={submitting}
                      onClick={handleConfirmSchedule}
                    >
                      {submitting ? 'Confirming…' : '✅ Confirm Schedule'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      disabled={submitting}
                      onClick={() => setShowRejectForm(true)}
                    >
                      ❌ Decline / Request Different Time
                    </button>
                  </div>
                ) : (
                  <div style={{ background: '#fef2f2', padding: '0.85rem', borderRadius: '8px', border: '1px solid #fecaca' }}>
                    <div style={{ fontWeight: 600, color: '#991b1b', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                      Decline Schedule Proposal
                    </div>
                    <textarea
                      className="form-input"
                      rows={2}
                      placeholder="Optional reason for declining (e.g., conflicting appointment, prefer afternoons)…"
                      value={rejectReason}
                      onChange={e => setRejectReason(e.target.value)}
                      style={{ fontSize: '0.82rem', marginBottom: '0.65rem' }}
                    />
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        disabled={submitting}
                        onClick={handleRejectSchedule}
                      >
                        {submitting ? 'Declining…' : 'Confirm Decline'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-muted btn-sm"
                        onClick={() => setShowRejectForm(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── OBSERVER VIEW ── */}
            {myRole === 'observer' && (
              <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border)', paddingTop: '0.85rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                👁️ <em>You are an observer for this leg. Scheduling is coordinated directly between {teacher?.name} and {learner?.name}.</em>
              </div>
            )}

            {/* Schedule History Section */}
            {legData.scheduleHistory && legData.scheduleHistory.length > 0 && (
              <div style={{ marginTop: '1.5rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
                <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
                  Schedule History ({legData.scheduleHistory.length}):
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: 160, overflowY: 'auto' }}>
                  {legData.scheduleHistory.map((item, idx) => (
                    <div
                      key={item.proposalId || idx}
                      style={{
                        padding: '0.4rem 0.65rem',
                        borderRadius: '6px',
                        background: '#f8fafc',
                        border: '1px solid var(--border)',
                        fontSize: '0.76rem',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '0.5rem',
                      }}
                    >
                      <div>
                        <strong>{formatInTimezone(item.scheduledTime, browserTimezone)}</strong>
                        {item.notes && <span style={{ color: 'var(--text-muted)', marginLeft: '0.4rem' }}>— {item.notes}</span>}
                      </div>
                      <span
                        className="badge"
                        style={{
                          fontSize: '0.68rem',
                          textTransform: 'uppercase',
                          background: item.status === 'confirmed' ? '#ecfdf5' : '#fef2f2',
                          color: item.status === 'confirmed' ? '#065f46' : '#991b1b',
                          border: `1px solid ${item.status === 'confirmed' ? '#a7f3d0' : '#fecaca'}`,
                        }}
                      >
                        {item.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Footer */}
        <div style={{ marginTop: '1.5rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-muted" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
