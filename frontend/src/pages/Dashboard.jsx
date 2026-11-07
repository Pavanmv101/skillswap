import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../api/axios'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import Spinner from '../components/Spinner'
import Avatar from '../components/Avatar'
import Stars from '../components/Stars'
import ScoreBadge from '../components/ScoreBadge'
import SwapModal from '../components/SwapModal'
import {
  IconDashboard,
  IconDiscover,
  IconSparkles,
  IconSwaps,
  IconLearning,
  IconCalendar,
  IconVideo,
  IconBell,
  IconCheckCircle,
  IconArrowRight,
  IconShield,
  IconUser,
  IconClock
} from '../components/Icons'

export default function Dashboard() {
  const { user } = useAuth()
  const { addToast } = useToast()

  const [profile, setProfile] = useState(null)
  const [stats, setStats] = useState(null)
  const [incomingSwaps, setIncomingSwaps] = useState([])
  const [activeSwaps, setActiveSwaps] = useState([])
  const [learningTracks, setLearningTracks] = useState([])
  const [topPicks, setTopPicks] = useState([])
  const [recentNotifications, setRecentNotifications] = useState([])
  const [loading, setLoading] = useState(true)
  const [swapModalTarget, setSwapModalTarget] = useState(null)

  async function loadDashboardData() {
    try {
      const [profileRes, swapsRes, matchRes, learningRes, recRes, notifRes] = await Promise.all([
        api.get('/profile').catch(() => ({ data: null })),
        api.get('/swap').catch(() => ({ data: [] })),
        api.get('/match').catch(() => ({ data: { matches: [] } })),
        api.get('/learning/dashboard').catch(() => ({ data: { learning: [], stats: {} } })),
        api.get('/recommendations/dashboard').catch(() => ({ data: { recommendations: [] } })),
        api.get('/notifications').catch(() => ({ data: { notifications: [] } })),
      ])

      const prof = profileRes.data || {}
      const swaps = swapsRes.data || []
      const matches = matchRes.data?.matches || []
      const learning = learningRes.data?.learning || []
      const recs = recRes.data?.recommendations || []
      const notifs = notifRes.data?.notifications || notifRes.data || []

      setProfile(prof)
      setLearningTracks(learning)
      setTopPicks(recs)
      setRecentNotifications(Array.isArray(notifs) ? notifs.slice(0, 4) : [])

      const pending = swaps.filter(s => s.status === 'pending')
      const active = swaps.filter(s => s.status === 'accepted')
      const done = swaps.filter(s => s.status === 'completed')

      setStats({
        skillsOffered: prof.skillsOffered?.length || 0,
        skillsWanted: prof.skillsWanted?.length || 0,
        matchCount: matches.length,
        pendingCount: pending.length,
        activeCount: active.length,
        completedCount: done.length,
        avgRating: prof.averageRating || 0,
        totalRatings: prof.totalRatings || 0,
        hasVerifiedSkill: (prof.skillsOffered || []).some(s => s.verified),
      })

      const uid = user?.id || user?._id
      const incoming = pending.filter(s => s.toUser?._id === uid || s.toUser === uid)
      setIncomingSwaps(incoming)
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
      addToast('Exchange accepted! WebRTC room created.', 'success')
      loadDashboardData()
    } catch (err) {
      addToast(err.response?.data?.message || 'Failed to accept exchange', 'error')
    }
  }

  async function handleQuickReject(id) {
    try {
      await api.put(`/swap/${id}/reject`)
      addToast('Request declined', 'info')
      loadDashboardData()
    } catch (err) {
      addToast('Failed to reject request', 'error')
    }
  }

  if (loading) {
    return <Spinner message="Preparing your workspace overview…" />
  }

  // Derive recommended next action
  const hasSkills = (stats?.skillsOffered || 0) > 0 && (stats?.skillsWanted || 0) > 0
  const hasIncoming = incomingSwaps.length > 0
  const firstActiveWithRoom = activeSwaps.find(s => s.roomId)

  return (
    <div className="page dashboard-page">
      {/* ─── Hero Header & Welcome ─────────────────────────────────────────── */}
      <div className="dash-hero-banner">
        <div className="dash-hero-info">
          <Avatar name={profile?.name || user?.name} size={58} />
          <div className="dash-hero-titles">
            <div className="dash-tag-row">
              <span className="dash-pill-badge">Workspace</span>
              {stats?.hasVerifiedSkill && (
                <span className="dash-pill-badge badge-verified">
                  <IconShield size={12} /> Verified Peer
                </span>
              )}
            </div>
            <h1 className="dash-main-title">
              Welcome back, {profile?.name || user?.name}
            </h1>
            <p className="dash-sub-text">
              {profile?.bio || 'Manage your active peer skill barter exchanges, upcoming video rooms, and roadmap progress.'}
            </p>
          </div>
        </div>

        <div className="dash-hero-meta">
          <div className="dash-rating-box">
            <div className="rating-num">
              ★ {stats?.avgRating ? stats.avgRating.toFixed(1) : '5.0'}
            </div>
            <div className="rating-sub">
              {stats?.totalRatings ? `${stats.totalRatings} peer reviews` : 'New Member'}
            </div>
          </div>
          <Link to="/profile" className="btn btn-secondary btn-sm">
            <IconUser size={15} /> Edit Profile
          </Link>
        </div>
      </div>

      {/* ─── Recommended Next Action Alert ─────────────────────────────────── */}
      <div className="next-action-card">
        <div className="next-action-content">
          <div className="next-action-icon">
            {firstActiveWithRoom ? <IconVideo size={20} /> : hasIncoming ? <IconBell size={20} /> : !hasSkills ? <IconUser size={20} /> : <IconSparkles size={20} />}
          </div>
          <div className="next-action-text">
            <span className="action-tag">RECOMMENDED NEXT STEP</span>
            <div className="action-title">
              {firstActiveWithRoom ? (
                <>Active Exchange Session Ready with <strong>{firstActiveWithRoom.fromUser?.name === (profile?.name || user?.name) ? firstActiveWithRoom.toUser?.name : firstActiveWithRoom.fromUser?.name}</strong></>
              ) : hasIncoming ? (
                <>You have <strong>{incomingSwaps.length} pending exchange request{incomingSwaps.length > 1 ? 's' : ''}</strong> awaiting your response</>
              ) : !hasSkills ? (
                <>Complete your skill profile to unlock bidirectional match scoring</>
              ) : (
                <>Explore <strong>{topPicks.length} compatible peer recommendations</strong> tailored to your skills</>
              )}
            </div>
          </div>
        </div>

        <div className="next-action-btn">
          {firstActiveWithRoom ? (
            <Link to={`/room/${firstActiveWithRoom.roomId}`} className="btn btn-primary btn-sm shadow-glow">
              Join Video Room <IconArrowRight size={15} />
            </Link>
          ) : hasIncoming ? (
            <Link to="/swaps" className="btn btn-primary btn-sm shadow-glow">
              Review Requests <IconArrowRight size={15} />
            </Link>
          ) : !hasSkills ? (
            <Link to="/profile" className="btn btn-primary btn-sm shadow-glow">
              Setup Skills <IconArrowRight size={15} />
            </Link>
          ) : (
            <Link to="/recommendations" className="btn btn-primary btn-sm shadow-glow">
              View Recommendations <IconArrowRight size={15} />
            </Link>
          )}
        </div>
      </div>

      {/* ─── Summary KPI Metrics Grid ──────────────────────────────────────── */}
      <div className="dash-metrics-grid">
        <div className="dash-metric-card">
          <div className="metric-header">
            <span className="metric-label">Skills You Teach</span>
            <div className="metric-icon-wrap icon-indigo">
              <IconDiscover size={18} />
            </div>
          </div>
          <div className="metric-value">{stats?.skillsOffered || 0}</div>
          <span className="metric-hint">Active offered capabilities</span>
        </div>

        <div className="dash-metric-card">
          <div className="metric-header">
            <span className="metric-label">Skills You Want</span>
            <div className="metric-icon-wrap icon-emerald">
              <IconLearning size={18} />
            </div>
          </div>
          <div className="metric-value">{stats?.skillsWanted || 0}</div>
          <span className="metric-hint">Target learning subjects</span>
        </div>

        <div className="dash-metric-card">
          <div className="metric-header">
            <span className="metric-label">Active Exchanges</span>
            <div className="metric-icon-wrap icon-amber">
              <IconSwaps size={18} />
            </div>
          </div>
          <div className="metric-value">{stats?.activeCount || 0}</div>
          <span className="metric-hint">Accepted peer partnerships</span>
        </div>

        <div className="dash-metric-card">
          <div className="metric-header">
            <span className="metric-label">Completed Swaps</span>
            <div className="metric-icon-wrap icon-blue">
              <IconCheckCircle size={18} />
            </div>
          </div>
          <div className="metric-value">{stats?.completedCount || 0}</div>
          <span className="metric-hint">Mastered skill barters</span>
        </div>
      </div>

      {/* ─── Active Sessions Section ────────────────────────────────────────── */}
      {activeSwaps.length > 0 && (
        <section className="dash-section">
          <div className="dash-section-header">
            <div className="section-title-wrap">
              <h2 className="dash-section-title">Active Exchange Sessions</h2>
              <span className="section-counter-badge">{activeSwaps.length}</span>
            </div>
            <Link to="/swaps" className="dash-link-action">
              View all exchanges →
            </Link>
          </div>

          <div className="dash-sessions-list">
            {activeSwaps.map(s => {
              const partner = s.fromUser?._id === (user?.id || user?._id) ? s.toUser : s.fromUser
              return (
                <div className="dash-session-card" key={s._id}>
                  <div className="session-card-left">
                    <Avatar name={partner?.name} size={46} />
                    <div className="session-card-details">
                      <div className="session-partner-name">
                        Partner: <strong>{partner?.name}</strong>
                      </div>
                      <div className="session-skills-barter">
                        <span className="skill-pill-offer">Teaches: {s.offeredSkill}</span>
                        <span className="barter-arrow">⇄</span>
                        <span className="skill-pill-want">Learns: {s.wantedSkill}</span>
                      </div>
                      {s.scheduledAt && (
                        <div className="session-schedule-time">
                          <IconClock size={14} />
                          <span>Scheduled: {new Date(s.scheduledAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="session-card-actions">
                    <Link to={`/learning?swapId=${s._id}`} className="btn btn-secondary btn-sm">
                      <IconLearning size={15} /> Roadmap
                    </Link>
                    {s.roomId && (
                      <Link to={`/room/${s.roomId}`} className="btn btn-primary btn-sm shadow-glow">
                        <IconVideo size={15} /> Join Video Call
                      </Link>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ─── Top Recommended Peers ──────────────────────────────────────────── */}
      {topPicks.length > 0 && (
        <section className="dash-section">
          <div className="dash-section-header">
            <div className="section-title-wrap">
              <h2 className="dash-section-title">Top Recommended Peers</h2>
              <span className="section-counter-badge">{topPicks.length}</span>
            </div>
            <Link to="/recommendations" className="dash-link-action">
              View all recommendations →
            </Link>
          </div>

          <div className="dash-peers-grid">
            {topPicks.slice(0, 3).map(rec => (
              <div className="card peer-summary-card" key={rec.user._id}>
                <div className="peer-summary-top">
                  <div className="peer-summary-meta">
                    <Avatar name={rec.user.name} size={42} />
                    <div>
                      <Link to={`/user/${rec.user._id}`} className="peer-summary-name">
                        {rec.user.name}
                      </Link>
                      <Stars value={rec.user.averageRating || 0} count={rec.user.totalRatings} />
                    </div>
                  </div>
                  <ScoreBadge score={rec.score} />
                </div>

                {rec.reasons?.length > 0 && (
                  <div className="peer-match-reason">
                    <span>✦ {rec.reasons[0]}</span>
                  </div>
                )}

                <div className="peer-summary-skills">
                  {rec.matchedWants?.slice(0, 2).map((skill, i) => (
                    <span key={i} className="skill-pill-offer">
                      Teaches: {skill}
                    </span>
                  ))}
                  {rec.matchedOffers?.slice(0, 1).map((skill, i) => (
                    <span key={i} className="skill-pill-want">
                      Wants: {skill}
                    </span>
                  ))}
                </div>

                <div className="peer-summary-footer">
                  <span className="schedule-status-text">
                    {rec.availabilityOverlap ? '⏰ Schedule aligned' : 'Mutual compatibility'}
                  </span>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => setSwapModalTarget(rec)}
                  >
                    Request Swap
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ─── Learning Roadmaps Overview ────────────────────────────────────── */}
      {learningTracks.length > 0 && (
        <section className="dash-section">
          <div className="dash-section-header">
            <div className="section-title-wrap">
              <h2 className="dash-section-title">My Learning Progress</h2>
              <span className="section-counter-badge">{learningTracks.length}</span>
            </div>
            <Link to="/learning" className="dash-link-action">
              Open Learning Centre →
            </Link>
          </div>

          <div className="dash-learning-grid">
            {learningTracks.slice(0, 3).map(track => (
              <div className="card dash-track-card" key={track._id}>
                <div className="track-card-header">
                  <strong className="track-skill-name">{track.skillName}</strong>
                  <span className={`badge ${track.status === 'completed' ? 'badge-green' : 'badge-blue'}`}>
                    {track.status === 'completed' ? '✓ Mastered' : `${track.overallProgress}% Complete`}
                  </span>
                </div>

                <div className="track-progress-bar-bg">
                  <div
                    className="track-progress-fill"
                    style={{ width: `${track.overallProgress}%` }}
                  />
                </div>

                <div className="track-card-footer">
                  <span className="track-coach-label">
                    Peer Mentor: <strong>{track.instructor?.name || 'Assigned'}</strong>
                  </span>
                  <Link to={`/learning?trackId=${track._id}`} className="dash-link-action">
                    Roadmap →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ─── Incoming Requests & Recent Notifications ───────────────────────── */}
      <div className="dash-two-col-layout">
        {/* Incoming Requests */}
        <section className="dash-section">
          <div className="dash-section-header">
            <div className="section-title-wrap">
              <h2 className="dash-section-title">Pending Requests</h2>
              <span className="section-counter-badge">{incomingSwaps.length}</span>
            </div>
            <Link to="/swaps" className="dash-link-action">
              Manage →
            </Link>
          </div>

          {incomingSwaps.length === 0 ? (
            <div className="dash-empty-state">
              <IconSwaps size={32} />
              <p>No incoming exchange proposals right now.</p>
              <Link to="/matches" className="btn btn-secondary btn-sm">
                Discover New Peers
              </Link>
            </div>
          ) : (
            <div className="dash-requests-list">
              {incomingSwaps.map(s => (
                <div className="card dash-request-card" key={s._id}>
                  <div className="request-card-info">
                    <Avatar name={s.fromUser?.name} size={40} />
                    <div>
                      <Link to={`/user/${s.fromUser?._id}`} className="request-user-name">
                        {s.fromUser?.name}
                      </Link>
                      <div className="request-barter-flow">
                        <span>Offers: <strong>{s.offeredSkill}</strong></span>
                        <span>⇄</span>
                        <span>Wants: <strong>{s.wantedSkill}</strong></span>
                      </div>
                    </div>
                  </div>
                  <div className="request-card-actions">
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => handleQuickAccept(s._id)}
                    >
                      Accept
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleQuickReject(s._id)}
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Recent Activity */}
        <section className="dash-section">
          <div className="dash-section-header">
            <div className="section-title-wrap">
              <h2 className="dash-section-title">Recent Notifications</h2>
            </div>
            <Link to="/notifications" className="dash-link-action">
              All Activity →
            </Link>
          </div>

          {recentNotifications.length === 0 ? (
            <div className="dash-empty-state">
              <IconBell size={32} />
              <p>You're all caught up! No recent notifications.</p>
            </div>
          ) : (
            <div className="dash-notifs-list">
              {recentNotifications.map(n => (
                <div className={`dash-notif-item ${!n.read ? 'notif-unread' : ''}`} key={n._id}>
                  <div className="notif-dot-wrap">
                    <span className="notif-status-dot" />
                  </div>
                  <div className="notif-text-wrap">
                    <div className="notif-title-row">
                      <span className="notif-title">{n.title}</span>
                      <span className="notif-time">
                        {new Date(n.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                    <p className="notif-message">{n.message}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Swap Modal Integration */}
      {swapModalTarget && (
        <SwapModal
          peer={swapModalTarget.user}
          compatibilityScore={swapModalTarget.score}
          onClose={() => setSwapModalTarget(null)}
          onSuccess={() => {
            setSwapModalTarget(null)
            addToast('Swap proposal submitted successfully!', 'success')
            loadDashboardData()
          }}
        />
      )}
    </div>
  )
}
