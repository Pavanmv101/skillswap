import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../api/axios'
import { useAuth } from '../context/AuthContext'
import Spinner from '../components/Spinner'
import RatingModal from '../components/RatingModal'
import ScheduleModal from '../components/ScheduleModal'

const STATUS_COLORS = {
  pending:   '#f59e0b',
  accepted:  '#10b981',
  rejected:  '#ef4444',
  cancelled: '#6b7280',
  completed: '#6366f1',
}

export default function Swaps() {
  const { user } = useAuth()
  const [swaps, setSwaps]     = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab]         = useState('received') // received | sent | active | completed
  const [ratingTarget, setRatingTarget]     = useState(null)
  const [scheduleTarget, setScheduleTarget] = useState(null)
  const [error, setError] = useState('')

  async function loadSwaps() {
    try {
      const { data } = await api.get('/swap')
      setSwaps(data)
    } catch (err) {
      setError('Failed to load swaps')
    } finally { setLoading(false) }
  }

  useEffect(() => { loadSwaps() }, [])

  // Action handlers
  async function handleAction(id, action, body = {}) {
    try {
      await api.put(`/swap/${id}/${action}`, body)
      loadSwaps()
    } catch (err) {
      alert(err.response?.data?.message || `Failed to ${action}`)
    }
  }

  // Filter swaps by tab
  const uid = user?.id
  const filtered = swaps.filter(s => {
    const from = s.fromUser?._id
    const to   = s.toUser?._id
    if (tab === 'received')  return to === uid && s.status === 'pending'
    if (tab === 'sent')      return from === uid && s.status === 'pending'
    if (tab === 'active')    return s.status === 'accepted'
    if (tab === 'completed') return s.status === 'completed'
    return true
  })

  if (loading) return <Spinner message="Loading swaps…" />

  return (
    <div className="page">
      <h2>My Swaps</h2>
      {error && <div className="alert alert-error">⚠ {error}</div>}

      {/* Tabs */}
      <div className="tabs">
        {['received', 'sent', 'active', 'completed'].map(t => (
          <button key={t} className={`tab ${tab === t ? 'tab-active' : ''}`} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
            {t === 'received' && (() => { const c = swaps.filter(s => s.toUser?._id === uid && s.status === 'pending').length; return c > 0 ? ` (${c})` : '' })()}
          </button>
        ))}
      </div>

      {filtered.length === 0 && (
        <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
          No {tab} swaps.{tab === 'received' && ' Check back later!'}{tab === 'sent' && <> <Link to="/matches">Find matches</Link> to send requests.</>}
        </p>
      )}

      <div className="card-list" style={{ marginTop: '1rem' }}>
        {filtered.map(s => {
          const other    = s.fromUser?._id === uid ? s.toUser : s.fromUser
          const isSender = s.fromUser?._id === uid
          return (
            <div className="card" key={s._id}>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Link to={`/user/${other?._id}`} className="card-name">{other?.name || 'User'}</Link>
                <span className="badge" style={{ background: STATUS_COLORS[s.status] || '#6b7280', color: '#fff' }}>
                  {s.status}
                </span>
              </div>

              {/* Skill Info */}
              <p style={{ fontSize: '.88rem', margin: '.5rem 0' }}>
                {isSender ? (
                  <>You offer <strong>{s.offeredSkill}</strong> → want <strong>{s.wantedSkill}</strong></>
                ) : (
                  <>They offer <strong>{s.offeredSkill}</strong> → want your <strong>{s.wantedSkill}</strong></>
                )}
              </p>

              {/* Scheduled time */}
              {s.scheduledAt && (
                <p style={{ fontSize: '.82rem', color: 'var(--primary)' }}>
                  📅 Scheduled: {new Date(s.scheduledAt).toLocaleString()}
                </p>
              )}

              {/* Compatibility */}
              {s.compatibilityScore > 0 && (
                <p style={{ fontSize: '.78rem', color: 'var(--text-muted)' }}>
                  Compatibility: {s.compatibilityScore}% — {s.compatibilityNote}
                </p>
              )}

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginTop: '.75rem' }}>
                {/* Received pending → accept / reject */}
                {tab === 'received' && (
                  <>
                    <button className="btn btn-primary btn-sm" onClick={() => handleAction(s._id, 'accept')}>Accept</button>
                    <button className="btn btn-danger btn-sm" onClick={() => handleAction(s._id, 'reject')}>Reject</button>
                  </>
                )}

                {/* Sent pending → cancel */}
                {tab === 'sent' && (
                  <button className="btn btn-danger btn-sm" onClick={() => handleAction(s._id, 'cancel')}>Cancel</button>
                )}

                {/* Active → join room, schedule, complete */}
                {tab === 'active' && (
                  <>
                    {s.roomId && <Link to={`/room/${s.roomId}`} className="btn btn-primary btn-sm">🎥 Join Video</Link>}
                    <button className="btn btn-accent btn-sm" onClick={() => setScheduleTarget(s)}>📅 Schedule</button>
                    <button className="btn btn-muted btn-sm" onClick={() => handleAction(s._id, 'complete')}>✅ Mark Complete</button>
                  </>
                )}

                {/* Completed → rate */}
                {tab === 'completed' && (
                  <button className="btn btn-accent btn-sm" onClick={() => setRatingTarget(s)}>⭐ Rate</button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Modals */}
      {ratingTarget   && <RatingModal swap={ratingTarget} onClose={() => { setRatingTarget(null); loadSwaps() }} />}
      {scheduleTarget && <ScheduleModal swap={scheduleTarget} onClose={() => { setScheduleTarget(null); loadSwaps() }} />}
    </div>
  )
}
