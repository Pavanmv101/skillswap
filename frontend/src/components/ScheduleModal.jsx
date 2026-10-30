import { useState, useMemo } from 'react'
import api from '../api/axios'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import AvailabilityCalendar, { findMutualOverlaps } from './AvailabilityCalendar'

export default function ScheduleModal({ swap, onClose }) {
  const { user } = useAuth()
  const { addToast } = useToast()

  // Format existing scheduled time if any, else default to empty
  const [dateTime, setDateTime] = useState(
    swap?.scheduledAt ? new Date(swap.scheduledAt).toISOString().slice(0, 16) : ''
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone]   = useState(false)

  // Identify partner and extract availability slots
  const partner = useMemo(() => {
    const isFromMe = (swap?.fromUser?._id === user?.id || swap?.fromUser === user?.id)
    return isFromMe ? swap?.toUser : swap?.fromUser
  }, [swap, user])

  const mySlots = useMemo(() => {
    const isFromMe = (swap?.fromUser?._id === user?.id || swap?.fromUser === user?.id)
    return isFromMe ? swap?.fromUser?.availabilitySlots || [] : swap?.toUser?.availabilitySlots || []
  }, [swap, user])

  const partnerSlots = partner?.availabilitySlots || []

  const mutualOverlaps = useMemo(() => {
    return findMutualOverlaps(mySlots, partnerSlots)
  }, [mySlots, partnerSlots])

  // Helper: given a day name and time ("18:00"), computes next occurrence ISO string (YYYY-MM-DDTHH:MM)
  function getNextDateTimeForSlot(dayName, timeStr) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const targetDayIndex = days.indexOf(dayName)
    if (targetDayIndex === -1) return ''

    const now = new Date()
    const result = new Date(now)
    let daysToAdd = (targetDayIndex - now.getDay() + 7) % 7
    if (daysToAdd === 0) {
      // If it's today, check if the hour has already passed
      const [slotH, slotM] = timeStr.split(':').map(Number)
      if (now.getHours() > slotH || (now.getHours() === slotH && now.getMinutes() >= slotM)) {
        daysToAdd = 7 // schedule for next week
      }
    }

    result.setDate(now.getDate() + daysToAdd)
    const [h, m] = timeStr.split(':')
    result.setHours(parseInt(h, 10), parseInt(m, 10), 0, 0)

    // Format local date YYYY-MM-DDTHH:MM without timezone shift
    const year = result.getFullYear()
    const month = String(result.getMonth() + 1).padStart(2, '0')
    const date = String(result.getDate()).padStart(2, '0')
    const hours = String(result.getHours()).padStart(2, '0')
    const mins = String(result.getMinutes()).padStart(2, '0')

    return `${year}-${month}-${date}T${hours}:${mins}`
  }

  function handleQuickPickSlot(slot) {
    const nextDate = getNextDateTimeForSlot(slot.day, slot.from)
    if (nextDate) {
      setDateTime(nextDate)
      addToast(`Selected ${slot.day} at ${slot.from} (${slot.from} - ${slot.to})`, 'info')
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!dateTime) {
      setError('Please select a valid date and time')
      return
    }

    const pickedDate = new Date(dateTime)
    if (isNaN(pickedDate.getTime())) {
      setError('Invalid date format')
      return
    }

    if (pickedDate < new Date()) {
      setError('Session time must be in the future')
      addToast('Cannot schedule sessions in the past', 'warning')
      return
    }

    setLoading(true)
    try {
      await api.put(`/swap/${swap._id}/schedule`, { scheduledAt: dateTime })
      setDone(true)
      addToast('Session scheduled successfully! 📅', 'success')
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to schedule session'
      setError(msg)
      addToast(msg, 'error')
    } finally {
      setLoading(false)
    }
  }

  // Get current local time ISO string for min attribute in input
  const minDateTime = useMemo(() => {
    const now = new Date()
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
    return now.toISOString().slice(0, 16)
  }, [])

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 540 }}>
        {done ? (
          <div style={{ textAlign: 'center', padding: '1rem 0' }}>
            <div style={{ fontSize: '3rem', marginBottom: '.75rem' }}>📅</div>
            <h3>Session Scheduled!</h3>
            <p style={{ color: 'var(--text-muted)', margin: '.75rem 0 1.5rem', lineHeight: 1.5 }}>
              Session confirmed with <strong>{partner?.name || 'partner'}</strong> for{' '}
              <strong>{new Date(dateTime).toLocaleString([], { dateStyle: 'full', timeStyle: 'short' })}</strong>.
            </p>
            <button className="btn btn-primary btn-block" onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <div>
                <h3 style={{ margin: 0 }}>Schedule Live Video Session</h3>
                <p style={{ fontSize: '.84rem', color: 'var(--text-muted)', margin: '.25rem 0 0' }}>
                  Coordinating exchange with <strong>{partner?.name || 'Partner'}</strong>
                </p>
              </div>
              <button className="toast-close" onClick={onClose} style={{ fontSize: '1.2rem' }}>✕</button>
            </div>

            {error && <div className="alert alert-error">⚠ {error}</div>}

            {/* Overlapping Availability Helper */}
            {partnerSlots.length > 0 && (
              <div style={{ marginBottom: '1.25rem' }}>
                <AvailabilityCalendar
                  slots={partnerSlots}
                  peerSlots={mySlots}
                  title={`${partner?.name || 'Partner'}'s Free Hours`}
                  onSelectSlot={handleQuickPickSlot}
                />
              </div>
            )}

            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">
                  Pick Session Date & Time <span style={{ color: 'var(--primary)' }}>★</span>
                </label>
                <input
                  className="form-input"
                  type="datetime-local"
                  value={dateTime}
                  min={minDateTime}
                  onChange={e => setDateTime(e.target.value)}
                  required
                />
                <span style={{ fontSize: '.76rem', color: 'var(--text-subtle)', marginTop: '.3rem', display: 'block' }}>
                  Tip: Click any slot above to auto-fill the next matching time.
                </span>
              </div>

              <div style={{ display: 'flex', gap: '.5rem', marginTop: '1.5rem' }}>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={loading}>
                  {loading ? 'Confirming…' : 'Save Session Schedule'}
                </button>
                <button type="button" className="btn btn-muted" onClick={onClose} disabled={loading}>
                  Cancel
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
