import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../api/axios'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import Spinner from '../components/Spinner'
import Avatar from '../components/Avatar'
import Stars from '../components/Stars'

export default function Dashboard() {
  const { user } = useAuth()
  const { addToast } = useToast()
  const [profile, setProfile] = useState(null)
  const [stats, setStats]     = useState(null)
  const [incomingSwaps, setIncomingSwaps] = useState([])
  const [activeSwaps, setActiveSwaps]     = useState([])
  const [loading, setLoading] = useState(true)

  async function loadDashboardData() {
    try {
      const [profileRes, swapsRes, matchRes] = await Promise.all([
        api.get('/profile'),
        api.get('/swap'),
        api.get('/match'),
      ])

      const prof = profileRes.data
      const swaps = swapsRes.data || []
      const matches = matchRes.data.matches || []

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
        <Link to="/matches" className="btn btn-primary shadow-glow">
          ⚡ Browse Skill Matches
        </Link>
        <Link to="/swaps" className="btn btn-muted">
          📋 Manage Swap Requests {incomingSwaps.length > 0 && `(${incomingSwaps.length} pending)`}
        </Link>
        <Link to="/profile" className="btn btn-ghost">
          ⚙️ Update Availability & Skills
        </Link>
      </div>

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
                  <div className="session-actions">
                    {s.roomId && (
                      <Link to={`/room/${s.roomId}`} className="btn btn-primary btn-sm shadow-glow">
                        🎥 Join Video Call
                      </Link>
                    )}
                  </div>
                </div>
              )
            })}
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
