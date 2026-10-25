import { useState } from 'react'
import api from '../api/axios'
import { useAuth } from '../context/AuthContext'

export default function RatingModal({ swap, onClose }) {
  const { user } = useAuth()
  const rateeId   = swap.fromUser._id === user?.id ? swap.toUser._id   : swap.fromUser._id
  const rateeName = swap.fromUser._id === user?.id ? swap.toUser.name  : swap.fromUser.name
  const [score, setScore] = useState(5)
  const [comment, setComment] = useState('')
  const [error, setError] = useState('')
  const [done, setDone]   = useState(false)

  async function handleSubmit(e) {
    e.preventDefault(); setError('')
    try { await api.post('/rating', { swapRequestId: swap._id, ratee: rateeId, score: Number(score), comment }); setDone(true) }
    catch (err) { setError(err.response?.data?.message || 'Failed to submit rating') }
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        {done ? (
          <><h3>⭐ Rating Submitted!</h3><p style={{color:'var(--text-muted)',margin:'.75rem 0'}}>Thank you for rating <strong>{rateeName}</strong>.</p><button className="btn btn-primary" onClick={onClose}>Close</button></>
        ) : (
          <>
            <h3>Rate {rateeName}</h3>
            {error && <div className="alert alert-error">⚠ {error}</div>}
            <form onSubmit={handleSubmit}>
              <div className="form-group"><label className="form-label">Score</label><select className="form-select" value={score} onChange={e => setScore(e.target.value)}>{[5,4,3,2,1].map(n => <option key={n} value={n}>{'★'.repeat(n)} ({n}/5)</option>)}</select></div>
              <div className="form-group"><label className="form-label">Comment (optional)</label><textarea className="form-textarea" rows={3} value={comment} onChange={e => setComment(e.target.value)} placeholder="How was the session?" /></div>
              <div style={{display:'flex',gap:'.5rem',marginTop:'.75rem'}}><button type="submit" className="btn btn-primary">Submit Rating</button><button type="button" className="btn btn-muted" onClick={onClose}>Cancel</button></div>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
