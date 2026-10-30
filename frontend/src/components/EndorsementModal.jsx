import { useState, useEffect } from 'react'
import api from '../api/axios'
import { useToast } from '../context/ToastContext'
import Avatar from './Avatar'

export default function EndorsementModal({ partner, onClose, onSuccess }) {
  const { addToast } = useToast()

  const [completedSwaps, setCompletedSwaps] = useState([])
  const [selectedSwapId, setSelectedSwapId] = useState('')
  const [selectedSkill, setSelectedSkill]   = useState(partner?.skillsOffered?.[0]?.skill || '')
  const [comment, setComment]               = useState('')
  const [loading, setLoading]               = useState(false)
  const [fetching, setFetching]             = useState(true)
  const [error, setError]                   = useState('')

  // Load completed swaps between the logged-in user and this partner
  useEffect(() => {
    async function fetchSwaps() {
      try {
        const { data } = await api.get('/swap')
        const pId = partner?._id || partner?.id
        const relevant = (data || []).filter(
          s => s.status === 'completed' &&
               ((s.fromUser?._id === pId || s.fromUser === pId) || (s.toUser?._id === pId || s.toUser === pId))
        )
        setCompletedSwaps(relevant)
        if (relevant.length > 0) {
          setSelectedSwapId(relevant[0]._id)
        }
      } catch (err) {
        setError('Could not verify completed swap history')
      } finally {
        setFetching(false)
      }
    }
    fetchSwaps()
  }, [partner])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!selectedSkill) {
      setError('Please select a skill to endorse')
      return
    }

    if (!selectedSwapId) {
      setError('A completed swap session is required to endorse this partner')
      return
    }

    setLoading(true)
    try {
      await api.post('/endorsements', {
        recipient: partner?._id || partner?.id,
        skillName: selectedSkill,
        swapRequestId: selectedSwapId,
        comment: comment.trim(),
      })

      addToast(`Successfully endorsed ${partner?.name} in "${selectedSkill}"! ⭐`, 'success')
      if (onSuccess) onSuccess()
      onClose()
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to submit endorsement'
      setError(msg)
      addToast(msg, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal" style={{ maxWidth: 500 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '1.25rem' }}>
          <Avatar name={partner?.name} size={46} />
          <div>
            <h3 style={{ margin: 0 }}>Endorse Peer Skill ⭐</h3>
            <p style={{ margin: '.2rem 0 0', fontSize: '.84rem', color: 'var(--text-muted)' }}>
              for <strong>{partner?.name}</strong> based on your completed exchange
            </p>
          </div>
        </div>

        {error && <div className="alert alert-error">⚠ {error}</div>}

        {fetching ? (
          <p style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-muted)' }}>
            Verifying completed barter history…
          </p>
        ) : completedSwaps.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '1rem' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '.5rem' }}>🔒</div>
            <h4>Completed Exchange Required</h4>
            <p style={{ fontSize: '.86rem', color: 'var(--text-muted)', margin: '.5rem 0 1.25rem', lineHeight: 1.5 }}>
              Peer skill endorsements are reserved for students who have successfully finished a barter swap together.
            </p>
            <button className="btn btn-muted btn-block" onClick={onClose}>
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {/* Select Skill */}
            <div className="form-group">
              <label className="form-label">
                Select Skill to Endorse <span style={{ color: 'var(--primary)' }}>★</span>
              </label>
              <select
                className="form-select"
                value={selectedSkill}
                onChange={e => setSelectedSkill(e.target.value)}
                required
              >
                {(partner?.skillsOffered || []).map((s, idx) => (
                  <option key={idx} value={s.skill}>
                    {s.skill} ({s.category} - {s.level})
                  </option>
                ))}
              </select>
            </div>

            {/* Select Completed Swap as Verification Proof */}
            <div className="form-group">
              <label className="form-label">
                Associated Completed Swap <span style={{ color: 'var(--primary)' }}>★</span>
              </label>
              <select
                className="form-select"
                value={selectedSwapId}
                onChange={e => setSelectedSwapId(e.target.value)}
                required
              >
                {completedSwaps.map(s => (
                  <option key={s._id} value={s._id}>
                    Exchanged: {s.offeredSkill} ⇄ {s.wantedSkill} ({new Date(s.createdAt).toLocaleDateString()})
                  </option>
                ))}
              </select>
            </div>

            {/* Optional Endorsement Recommendation Comment */}
            <div className="form-group">
              <label className="form-label">Recommendation Feedback (Optional)</label>
              <textarea
                className="form-textarea"
                rows={3}
                placeholder="Share a short note on how well they taught or demonstrated this skill during your session..."
                value={comment}
                onChange={e => setComment(e.target.value)}
                maxLength={300}
              />
            </div>

            <div style={{ display: 'flex', gap: '.5rem', marginTop: '1.25rem' }}>
              <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={loading}>
                {loading ? 'Submitting…' : 'Submit Peer Endorsement'}
              </button>
              <button type="button" className="btn btn-muted" onClick={onClose} disabled={loading}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
