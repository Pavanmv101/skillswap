import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../api/axios'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import Spinner from '../components/Spinner'
import Avatar from '../components/Avatar'
import Stars from '../components/Stars'
import ScoreBadge from '../components/ScoreBadge'

export default function Dashboard() {
  const { user } = useAuth()
  const { addToast } = useToast()
  const [profile, setProfile] = useState(null)
  const [stats, setStats]     = useState(null)
  const [incomingSwaps, setIncomingSwaps] = useState([])
  const [activeSwaps, setActiveSwaps]     = useState([])
  const [learningTracks, setLearningTracks] = useState([])
  const [topPicks, setTopPicks]             = useState([])
  const [loading, setLoading] = useState(true)

  async function loadDashboardData() {
    try {
      const [profileRes, swapsRes, matchRes, learningRes, recRes] = await Promise.all([
        api.get('/profile'),
        api.get('/swap'),
        api.get('/match'),
        api.get('/learning/dashboard').catch(() => ({ data: { learning: [], stats: {} } })),
        api.get('/recommendations/dashboard').catch(() => ({ data: { recommendations: [] } })),
      ])

      const prof = profileRes.data
      const swaps = swapsRes.data || []
      const matches = matchRes.data.matches || []
      const learning = learningRes.data?.learning || []
      const recs = recRes.data?.recommendations || []
      setLearningTracks(learning)
      setTopPicks(recs)

      setProfile(prof)

      const pending = swaps.filter(s => s.status === 'pending')
      const active  = swaps.filter(s => s.status === 'accepted')
      const done    = swaps.filter(s => s.status === 'completed')

      setStats({
        skillsOffered:  prof.skillsOffered?.length  || 0,
        skillsWanted:   prof.skillsWanted?.length   || 0,
        matchCount:     matches.length,
        pendingCount:   pending.length,
        activeCount:    active.length,
        completedCount: done.length,
        avgRating:      prof.averageRating || 0,
        totalRatings:   prof.totalRatings  || 0,
      })

      // Incoming pending requests directed to me
      const incoming = pending.filter(s => s.toUser?._id === user?.id || s.toUser === user?.id)
      setIncomingSwaps(incoming)

      // Active accepted sessions
      setActiveSwaps(active)
    } catch (err) {
      console.error('Dashboard load error:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDashboardData()
  }, [user])

  async function handleQuickAccept(id) {
    try {
      await api.put(`/swap/${id}/accept`)
      addToast('Swap accepted! Room link created 🚀', 'success')
      loadDashboardData()
    } catch (err) {
      addToast(err.response?.data?.message || 'Failed to accept', 'error')
    }
  }

  async function handleQuickReject(id) {
    try {
      await api.put(`/swap/${id}/reject`)
      addToast('Request declined', 'info')
      loadDashboardData()
    } catch (err) {
      addToast('Failed to reject', 'error')
    }
  }

  if (loading) return <Spinner message="Preparing your dashboard…" />

  return (
    <div className="page dashboard-page">
      {/* Header Profile Greeting Card */}
      <div className="dashboard-hero-card">
        <div className="dash-hero-left">
          <Avatar name={profile?.name || user?.name} size={64} />
          <div>
            <div className="welcome-tag">Student Dashboard</div>
            <h2 className="dash-greeting">Welcome back, {profile?.name || user?.name}! 👋</h2>
            <p className="dash-bio">
              {profile?.bio || 'No bio yet. Add a short bio in your profile to attract better swap matches.'}
            </p>
          </div>
        </div>
        <div className="dash-hero-right">
          <div className="rating-pill">
            <span className="rating-val">⭐ {stats?.avgRating ? stats.avgRating.toFixed(1) : '0.0'}</span>
            <span className="rating-count">({stats?.totalRatings || 0} reviews)</span>
          </div>
          <Link to="/profile" className="btn btn-muted btn-sm" style={{ marginTop: '.5rem' }}>
            Edit Profile
          </Link>
        </div>
      </div>

      {/* KPI Stats Grid */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon-wrapper" style={{ background: '#eef2ff', color: '#6366f1' }}>📚</div>
          <span className="stat-number">{stats?.skillsOffered}</span>
          <span className="stat-label">Skills You Teach</span>
        </div>
        <div className="stat-card">
          <div className="stat-icon-wrapper" style={{ background: '#ecfdf5', color: '#10b981' }}>🎯</div>
          <span className="stat-number">{stats?.skillsWanted}</span>
          <span className="stat-label">Skills You Want</span>
        </div>
        <div className="stat-card">
          <div className="stat-icon-wrapper" style={{ background: '#fef3c7', color: '#d97706' }}>⚡</div>
          <span className="stat-number">{stats?.matchCount}</span>
          <span className="stat-label">Smart Matches</span>
        </div>
        <div className="stat-card">
          <div className="stat-icon-wrapper" style={{ background: '#f1f5f9', color: '#475569' }}>🔄</div>
          <span className="stat-number">{stats?.activeCount}</span>
          <span className="stat-label">Active Swaps</span>
        </div>
        <div className="stat-card">
          <div className="stat-icon-wrapper" style={{ background: '#eff6ff', color: '#2563eb' }}>✅</div>
          <span className="stat-number">{stats?.completedCount}</span>
          <span className="stat-label">Completed</span>
        </div>
      </div>

      {/* Quick Actions Bar */}
      <div className="quick-actions-bar">
        <Link to="/recommendations" className="btn btn-primary shadow-glow">
          ✨ For You Recommendations
        </Link>
        <Link to="/matches" className="btn btn-muted">
          ⚡ Browse Skill Matches
        </Link>
        <Link to="/swaps" className="btn btn-muted">
          📋 Manage Swap Requests {incomingSwaps.length > 0 && `(${incomingSwaps.length} pending)`}
        </Link>
        <Link to="/profile" className="btn btn-ghost">
          ⚙️ Update Availability & Skills
        </Link>
      </div>

      {/* Top Picks For You (Phase 5) */}
      {topPicks.length > 0 && (
        <div style={{ marginTop: '2.5rem' }}>
          <div className="section-title-row">
            <h3>✨ Top Picks For You ({topPicks.length})</h3>
            <Link to="/recommendations" className="link-subtle">View all recommendations →</Link>
          </div>
          <div className="card-grid" style={{ marginTop: '.75rem' }}>
            {topPicks.map(rec => (
              <div className="card" key={rec.user._id} style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '.6rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem' }}>
                      <Avatar name={rec.user.name} size={40} />
                      <div>
                        <Link to={`/user/${rec.user._id}`} className="card-name" style={{ fontSize: '1rem', fontWeight: 600 }}>
                          {rec.user.name}
                        </Link>
                        <Stars value={rec.user.averageRating || 0} count={rec.user.totalRatings} />
                      </div>
                    </div>
                    <ScoreBadge score={rec.score} />
                  </div>
                  {rec.reasons?.length > 0 && (
                    <p style={{ fontSize: '.8rem', color: 'var(--text-muted)', marginBottom: '.75rem', lineHeight: 1.4 }}>
                      💡 {rec.reasons[0]}
                    </p>
                  )}
                  <div className="tag-list" style={{ marginBottom: '.75rem' }}>
                    {rec.matchedWants?.slice(0, 2).map((skill, i) => (
                      <span key={i} className="tag tag-highlight" style={{ fontSize: '.72rem' }}>
                        Teaches: {skill}
                      </span>
                    ))}
                    {rec.matchedOffers?.slice(0, 1).map((skill, i) => (
                      <span key={i} className="tag tag-wanted" style={{ fontSize: '.72rem' }}>
                        Wants: {skill}
                      </span>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '.5rem', borderTop: '1px solid var(--border)', paddingTop: '.6rem' }}>
                  <span style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>
                    {rec.availabilityOverlap ? '⏰ Schedule aligned' : '⚡ High compatibility'}
                  </span>
                  <Link to="/recommendations" className="link-subtle" style={{ fontSize: '.8rem', fontWeight: 600 }}>
                    Details →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active Sessions Strip */}
      {activeSwaps.length > 0 && (
        <div style={{ marginTop: '2.5rem' }}>
          <div className="section-title-row">
            <h3>🎥 Active Video Sessions ({activeSwaps.length})</h3>
            <Link to="/swaps" className="link-subtle">View all</Link>
          </div>
          <div className="card-list" style={{ marginTop: '.75rem' }}>
            {activeSwaps.map(s => {
              const partner = s.fromUser?._id === user?.id ? s.toUser : s.fromUser
              return (
                <div className="card card-active-session" key={s._id}>
                  <div className="session-info">
                    <Avatar name={partner?.name} size={42} />
                    <div>
                      <div className="session-title">
                        Partner: <strong>{partner?.name}</strong>
                      </div>
                      <div className="session-skills">
                        Exchanging: <strong>{s.offeredSkill}</strong> ⇄ <strong>{s.wantedSkill}</strong>
                      </div>
                      {s.scheduledAt && (
                        <div className="session-time">
                          📅 Scheduled: {new Date(s.scheduledAt).toLocaleString()}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="session-actions" style={{ display: 'flex', gap: '.5rem' }}>
                    <Link to={`/learning?swapId=${s._id}`} className="btn btn-outline btn-sm">
                      🎯 Learning
                    </Link>
                    {s.roomId && (
                      <Link to={`/room/${s.roomId}`} className="btn btn-primary btn-sm shadow-glow">
                        🎥 Join Call
                      </Link>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Peer Learning Progress Summary */}
      {learningTracks.length > 0 && (
        <div style={{ marginTop: '2.5rem' }}>
          <div className="section-title-row">
            <h3>🎯 My Learning Roadmaps ({learningTracks.length})</h3>
            <Link to="/learning" className="link-subtle">Open learning center →</Link>
          </div>
          <div className="card-grid" style={{ marginTop: '.75rem' }}>
            {learningTracks.slice(0, 3).map(t => (
              <div className="card" key={t._id} style={{ padding: '1.1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '.6rem' }}>
                  <strong style={{ fontSize: '1.05rem' }}>{t.skillName}</strong>
                  <span className={`badge ${t.status === 'completed' ? 'badge-green' : 'badge-blue'}`}>
                    {t.status === 'completed' ? '✓ Mastered' : `${t.overallProgress}%`}
                  </span>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: 999, height: 6, overflow: 'hidden', marginBottom: '.6rem' }}>
                  <div
                    style={{
                      background: t.overallProgress === 100 ? '#10b981' : '#6366f1',
                      width: `${t.overallProgress}%`,
                      height: '100%',
                    }}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '.78rem', color: 'var(--text-muted)' }}>
                  <span>Coach: {t.instructor?.name}</span>
                  <Link to={`/learning?trackId=${t._id}`} className="link-subtle">
                    View Roadmap →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Incoming Requests Alerts */}
      <div style={{ marginTop: '2.5rem' }}>
        <div className="section-title-row">
          <h3>🔔 Pending Requests for You ({incomingSwaps.length})</h3>
          <Link to="/swaps" className="link-subtle">View swap center</Link>
        </div>

        {incomingSwaps.length === 0 ? (
          <div className="empty-subtle">
            <span>✨ No pending requests right now. Explore new peers in <Link to="/matches">Find Matches</Link>!</span>
          </div>
        ) : (
          <div className="card-list" style={{ marginTop: '.75rem' }}>
            {incomingSwaps.map(s => (
              <div className="card card-incoming" key={s._id}>
                <div className="incoming-left">
                  <Avatar name={s.fromUser?.name} size={44} />
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                      <Link to={`/user/${s.fromUser?._id}`} className="card-name">
                        {s.fromUser?.name}
                      </Link>
                      <Stars value={s.fromUser?.averageRating || 0} />
                    </div>
                    <div className="barter-flow-row" style={{ marginTop: '.35rem' }}>
                      <span className="badge badge-green">Offers: {s.offeredSkill}</span>
                      <span style={{ color: 'var(--text-muted)' }}>⇄</span>
                      <span className="badge badge-yellow">Wants: {s.wantedSkill}</span>
                    </div>
                  </div>
                </div>
                <div className="incoming-right">
                  <button className="btn btn-primary btn-sm" onClick={() => handleQuickAccept(s._id)}>
                    Accept
                  </button>
                  <button className="btn btn-muted btn-sm" onClick={() => handleQuickReject(s._id)}>
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
