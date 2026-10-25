import { useState } from 'react'
import api from '../api/axios'

export default function ScheduleModal({ swap, onClose }) {
  const [dateTime, setDateTime] = useState('')
  const [error, setError] = useState('')
  const [done, setDone]   = useState(false)

  async function handleSubmit(e) {
    e.preventDefault(); setError('')
    try { await api.put(`/swap/${swap._id}/schedule`, { scheduledAt: dateTime }); setDone(true) }
    catch (err) { setError(err.response?.data?.message || 'Failed to schedule') }
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        {done ? (
          <><h3>📅 Session Scheduled!</h3><p style={{color:'var(--text-muted)',margin:'.75rem 0'}}>Session set for {new Date(dateTime).toLocaleString()}.</p><button className="btn btn-primary" onClick={onClose}>Close</button></>
        ) : (
          <>
            <h3>Schedule a Session</h3>
            {error && <div className="alert alert-error">⚠ {error}</div>}
            <form onSubmit={handleSubmit}>
              <div className="form-group"><label className="form-label">Date & Time</label><input className="form-input" type="datetime-local" value={dateTime} onChange={e => setDateTime(e.target.value)} required /></div>
              <div style={{display:'flex',gap:'.5rem',marginTop:'.75rem'}}><button type="submit" className="btn btn-primary">Confirm</button><button type="button" className="btn btn-muted" onClick={onClose}>Cancel</button></div>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
