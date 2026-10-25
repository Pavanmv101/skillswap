import { useState } from 'react'
import api from '../api/axios'
import Avatar from './Avatar'
import { useToast } from '../context/ToastContext'

export default function SwapModal({ match, onClose }) {
  const targetUser = match?.user || match
  const defOffered = (match?.reverseMatches?.[0]) || ''
  const defWanted  = (match?.forwardMatches?.[0])  || ''
  const [offeredSkill, setOfferedSkill] = useState(defOffered)
  const [wantedSkill,  setWantedSkill]  = useState(defWanted)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sent,  setSent]  = useState(false)
  const { addToast } = useToast()

  async function handleSend(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await api.post('/swap', {
        toUser: targetUser._id,
        offeredSkill: offeredSkill.trim(),
        wantedSkill: wantedSkill.trim(),
        compatibilityScore: match?.compatibilityScore ?? 0,
        compatibilityNote: match?.compatibilityNote ?? ''
      })
      setSent(true)
      addToast(`Swap proposal sent to ${targetUser?.name}! 🚀`, 'success')
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to send request'
      setError(msg)
      addToast(msg, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        {sent ? (
          <div style={{ textAlign: 'center', padding: '1rem 0' }}>
            <div style={{ fontSize: '3rem', marginBottom: '.75rem' }}>🎉</div>
            <h3>Swap Request Sent!</h3>
            <p style={{ color: 'var(--text-muted)', margin: '.75rem 0 1.5rem', lineHeight: 1.5 }}>
              Your barter proposal has been delivered to <strong>{targetUser?.name}</strong>. You'll be notified when they accept.
            </p>
            <button className="btn btn-primary btn-block" onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '1.25rem' }}>
              <Avatar name={targetUser?.name} size={44} />
              <div>
                <h3 style={{ margin: 0 }}>Propose Skill Swap</h3>
                <p style={{ margin: 0, fontSize: '.82rem', color: 'var(--text-muted)' }}>
                  with {targetUser?.name}
                </p>
              </div>
            </div>

            {error && <div className="alert alert-error">⚠ {error}</div>}

            <form onSubmit={handleSend}>
              <div className="form-group">
                <label className="form-label">
                  Skill you will teach them <span style={{ color: 'var(--primary)' }}>★</span>
                </label>
                <input
                  className="form-input"
                  value={offeredSkill}
                  onChange={e => setOfferedSkill(e.target.value)}
                  placeholder="e.g. React, UI/UX Design, Guitar"
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">
                  Skill you want from them <span style={{ color: 'var(--primary)' }}>★</span>
                </label>
                <input
                  className="form-input"
                  value={wantedSkill}
                  onChange={e => setWantedSkill(e.target.value)}
                  placeholder="e.g. Python, Machine Learning"
                  required
                />
              </div>

              {match?.compatibilityScore > 0 && (
                <div style={{ background: '#f8fafc', padding: '.75rem', borderRadius: 8, marginBottom: '1rem', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '.78rem', fontWeight: 600, color: 'var(--primary)' }}>
                    ⚡ Match Score: {match.compatibilityScore}%
                  </div>
                  {match.compatibilityNote && (
                    <div style={{ fontSize: '.75rem', color: 'var(--text-muted)', marginTop: '.25rem' }}>
                      {match.compatibilityNote}
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: '.5rem', marginTop: '1.25rem' }}>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={loading}>
                  {loading ? 'Sending…' : 'Send Swap Request'}
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
