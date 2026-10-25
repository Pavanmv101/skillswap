import { useState } from 'react'
import api from '../api/axios'

export default function SwapModal({ match, onClose }) {
  const targetUser = match?.user || match
  const defOffered = (match?.reverseMatches?.[0]) || ''
  const defWanted  = (match?.forwardMatches?.[0])  || ''
  const [offeredSkill, setOfferedSkill] = useState(defOffered)
  const [wantedSkill,  setWantedSkill]  = useState(defWanted)
  const [error, setError] = useState('')
  const [sent,  setSent]  = useState(false)

  async function handleSend(e) {
    e.preventDefault(); setError('')
    try {
      await api.post('/swap', { toUser: targetUser._id, offeredSkill, wantedSkill, compatibilityScore: match?.compatibilityScore ?? 0, compatibilityNote: match?.compatibilityNote ?? '' })
      setSent(true)
    } catch (err) { setError(err.response?.data?.message || 'Failed to send request') }
  }

  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        {sent ? (
          <><h3>✅ Request Sent!</h3><p style={{color:'var(--text-muted)',margin:'.75rem 0'}}>Your swap request to <strong>{targetUser?.name}</strong> has been sent.</p><button className="btn btn-primary" onClick={onClose}>Close</button></>
        ) : (
          <>
            <h3>Request Swap with {targetUser?.name}</h3>
            {error && <div className="alert alert-error">⚠ {error}</div>}
            <form onSubmit={handleSend}>
              <div className="form-group"><label className="form-label">Skill I'm offering</label><input className="form-input" value={offeredSkill} onChange={e => setOfferedSkill(e.target.value)} placeholder="e.g. Python" required /></div>
              <div className="form-group"><label className="form-label">Skill I want from them</label><input className="form-input" value={wantedSkill} onChange={e => setWantedSkill(e.target.value)} placeholder="e.g. Guitar" required /></div>
              <div style={{display:'flex',gap:'.5rem',marginTop:'1rem'}}><button type="submit" className="btn btn-primary">Send Request</button><button type="button" className="btn btn-muted" onClick={onClose}>Cancel</button></div>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
