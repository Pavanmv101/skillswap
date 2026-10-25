import { useState } from 'react'
import api from '../api/axios'
import { useToast } from '../context/ToastContext'

export default function ScheduleModal({ swap, onClose }) {
  const [dateTime, setDateTime] = useState(
    swap?.scheduledAt ? new Date(swap.scheduledAt).toISOString().slice(0, 16) : ''
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone]   = useState(false)
  const { addToast } = useToast()

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
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

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        {done ? (
          <div style={{ textAlign: 'center', padding: '1rem 0' }}>
            <div style={{ fontSize: '3rem', marginBottom: '.75rem' }}>📅</div>
            <h3>Session Scheduled!</h3>
            <p style={{ color: 'var(--text-muted)', margin: '.75rem 0 1.5rem', lineHeight: 1.5 }}>
              Session confirmed for <strong>{new Date(dateTime).toLocaleString()}</strong>.
            </p>
            <button className="btn btn-primary btn-block" onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
          <>
            <h3>Schedule a Live Session</h3>
            <p style={{ fontSize: '.85rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
              Pick a date and time for your peer exchange video call.
            </p>

            {error && <div className="alert alert-error">⚠ {error}</div>}

            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">Date & Time</label>
                <input
                  className="form-input"
                  type="datetime-local"
                  value={dateTime}
                  onChange={e => setDateTime(e.target.value)}
                  required
                />
              </div>

              <div style={{ display: 'flex', gap: '.5rem', marginTop: '1.25rem' }}>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={loading}>
                  {loading ? 'Confirming…' : 'Set Schedule'}
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
