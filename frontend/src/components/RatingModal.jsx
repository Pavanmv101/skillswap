import { useState } from 'react'
import api from '../api/axios'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'

export default function RatingModal({ swap, onClose }) {
  const { user } = useAuth()
  const { addToast } = useToast()
  const rateeId   = swap.fromUser?._id === user?.id ? swap.toUser?._id   : swap.fromUser?._id
  const rateeName = swap.fromUser?._id === user?.id ? swap.toUser?.name  : swap.fromUser?.name
  const [score, setScore] = useState(5)
  const [comment, setComment] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone]   = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await api.post('/rating', {
        swapRequestId: swap._id,
        ratee: rateeId,
        score: Number(score),
        comment: comment.trim()
      })
      setDone(true)
      addToast(`Rating submitted for ${rateeName}! ⭐`, 'success')
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to submit rating'
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
            <div style={{ fontSize: '3rem', marginBottom: '.75rem' }}>⭐</div>
            <h3>Thank You for the Review!</h3>
            <p style={{ color: 'var(--text-muted)', margin: '.75rem 0 1.5rem', lineHeight: 1.5 }}>
              Your feedback helps keep the SkillSwap community trusted and credible.
            </p>
            <button className="btn btn-primary btn-block" onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
          <>
            <h3>Rate Your Session with {rateeName}</h3>
            <p style={{ fontSize: '.85rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
              How was your peer exchange experience?
            </p>

            {error && <div className="alert alert-error">⚠ {error}</div>}

            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">Score (1 to 5 Stars)</label>
                <div style={{ display: 'flex', gap: '.5rem', margin: '.5rem 0' }}>
                  {[1, 2, 3, 4, 5].map(star => (
                    <button
                      type="button"
                      key={star}
                      onClick={() => setScore(star)}
                      className={`star-select-btn ${star <= score ? 'star-active' : ''}`}
                    >
                      ★
                    </button>
                  ))}
                  <span style={{ alignSelf: 'center', fontWeight: 600, fontSize: '.9rem', marginLeft: '.5rem' }}>
                    {score} / 5
                  </span>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Review / Feedback (optional)</label>
                <textarea
                  className="form-textarea"
                  rows={3}
                  value={comment}
                  onChange={e => setComment(e.target.value)}
                  placeholder="Share details about what you learned, teaching style, punctuality..."
                />
              </div>

              <div style={{ display: 'flex', gap: '.5rem', marginTop: '1.25rem' }}>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={loading}>
                  {loading ? 'Submitting…' : 'Submit Review'}
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
