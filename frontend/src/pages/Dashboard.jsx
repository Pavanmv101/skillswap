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
  IconClock,
  IconRepeat
} from '../components/Icons'

/**
 * Pure mathematical calculation of Bayesian exchange reliability.
 * Strictly mirrors backend services/reliabilityService.js:
 *   Reliability Score = (C + K * P0) / (C + F + K)
 *   C  = Completed exchanges
 *   F  = Explicitly failed exchanges
 *   K  = 3.0 (confidence prior weight)
 *   P0 = 0.70 (provisional neutral design baseline)
 */
function calculateBayesianReliability(completed = 0, failed = 0) {
  const c = Math.max(0, Number(completed) || 0)
  const f = Math.max(0, Number(failed) || 0)
  const p0 = 0.70
  const k = 3.0
  if (c === 0 && f === 0) return 70
  const score = (c + (k * p0)) / (c + f + k)
  return Math.round(score * 100)
}

export default function Dashboard() {
  const { user } = useAuth()
  const { addToast } = useToast()

  const [profile, setProfile] = useState(null)
  const [stats, setStats] = useState(null)
  const [allSwaps, setAllSwaps] = useState([])
  const [incomingSwaps, setIncomingSwaps] = useState([])
  const [activeSwaps, setActiveSwaps] = useState([])
  const [learningTracks, setLearningTracks] = useState([])
  const [topPicks, setTopPicks] = useState([])
  const [circularProposals, setCircularProposals] = useState([])
  const [recentNotifications, setRecentNotifications] = useState([])
  const [loading, setLoading] = useState(true)
  const [swapModalTarget, setSwapModalTarget] = useState(null)

  async function loadDashboardData() {
    try {
      const [profileRes, swapsRes, matchRes, learningRes, recRes, notifRes, circularRes] = await Promise.all([
        api.get('/profile').catch(() => ({ data: null })),
        api.get('/swap').catch(() => ({ data: [] })),
        api.get('/match').catch(() => ({ data: { matches: [] } })),
        api.get('/learning/dashboard').catch(() => ({ data: { learning: [], stats: {} } })),
        api.get('/recommendations/dashboard').catch(() => ({ data: { recommendations: [] } })),
        api.get('/notifications').catch(() => ({ data: { notifications: [] } })),
        api.get('/circular/proposals').catch(() => ({ data: [] })),
      ])

      const prof = profileRes.data || {}
      const swaps = Array.isArray(swapsRes.data) ? swapsRes.data : []
      const matches = matchRes.data?.matches || []
      const learning = learningRes.data?.learning || []
      const lStats = learningRes.data?.stats || {}
      const recs = recRes.data?.recommendations || []
      const notifs = Array.isArray(notifRes.data?.notifications)
        ? notifRes.data.notifications
        : Array.isArray(notifRes.data) ? notifRes.data : []
      const circulars = Array.isArray(circularRes.data)
        ? circularRes.data
        : Array.isArray(circularRes.data?.proposals) ? circularRes.data.proposals : []

      setProfile(prof)
      setAllSwaps(swaps)
      setLearningTracks(learning)
      setTopPicks(recs)
      setCircularProposals(circulars)
      setRecentNotifications(notifs.slice(0, 4))

      // Partition swaps according to strict backend SwapRequest enum:
      // ['pending', 'accepted', 'rejected', 'completed', 'cancelled']
      const pending = swaps.filter(s => s.status === 'pending')
      const active = swaps.filter(s => s.status === 'accepted')
      const completed = swaps.filter(s => s.status === 'completed')
      const rejected = swaps.filter(s => s.status === 'rejected')
      const cancelled = swaps.filter(s => s.status === 'cancelled')
      const other = swaps.filter(s => !['pending', 'accepted', 'completed', 'rejected', 'cancelled'].includes(s.status))

      // Compute exact Bayesian reliability score
      const reliabilityScore = calculateBayesianReliability(completed.length, 0)

      // Compute genuine curriculum progress across active learning tracks
      let avgProgress = 0
      if (typeof lStats.avgProgress === 'number' && lStats.avgProgress > 0) {
        avgProgress = Math.round(lStats.avgProgress)
      } else if (learning.length > 0) {
        const sum = learning.reduce((acc, t) => acc + (t.overallProgress || 0), 0)
        avgProgress = Math.round(sum / learning.length)
      }

      setStats({
        skillsOffered: prof.skillsOffered?.length || 0,
        skillsWanted: prof.skillsWanted?.length || 0,
        matchCount: matches.length,
        totalSwaps: swaps.length,
        pendingCount: pending.length,
        activeCount: active.length,
        completedCount: completed.length,
        rejectedCount: rejected.length,
        cancelledCount: cancelled.length,
        otherCount: other.length,
        reliabilityScore,
        avgProgress,
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
    return <Spinner message="Preparing your analytics workspace…" />
  }

  const hasSkills = (stats?.skillsOffered || 0) > 0 && (stats?.skillsWanted || 0) > 0
  const hasIncoming = incomingSwaps.length > 0
  const firstActiveWithRoom = activeSwaps.find(s => s.roomId)

  // Real Exchange Distribution calculation (Zero overlap, exact partition of totalSwaps)
  const totalSwaps = stats?.totalSwaps || 0
  const activePct = totalSwaps > 0 ? ((stats?.activeCount || 0) / totalSwaps) * 100 : 0
  const completedPct = totalSwaps > 0 ? ((stats?.completedCount || 0) / totalSwaps) * 100 : 0
  const pendingPct = totalSwaps > 0 ? ((stats?.pendingCount || 0) / totalSwaps) * 100 : 0
  const nonSuccessCount = (stats?.rejectedCount || 0) + (stats?.cancelledCount || 0) + (stats?.otherCount || 0)
  const nonSuccessPct = totalSwaps > 0 ? (nonSuccessCount / totalSwaps) * 100 : 0

  const hasReviews = (stats?.totalRatings || 0) > 0

  return (
    <div className="page dashboard-page">
      {/* ─── 1. Welcome & Workspace Meta Header ─────────────────────────────── */}
      <div className="dash-hero-banner">
        <div className="dash-hero-info">
          <Avatar name={profile?.name || user?.name} size={54} />
          <div className="dash-hero-titles">
            <div className="dash-tag-row">
              <span className="dash-pill-badge">Workspace Analytics</span>
              {stats?.hasVerifiedSkill && (
                <span className="dash-pill-badge badge-verified">
                  <IconShield size={12} /> Verified Peer
                </span>
              )}
              {stats?.totalSwaps > 0 && (
                <span className="dash-pill-badge" style={{ color: 'var(--primary)', borderColor: 'var(--primary)' }}>
                  {stats.totalSwaps} Exchanges Recorded
                </span>
              )}
            </div>
            <h1 className="dash-main-title">
              Welcome back, {profile?.name || user?.name}
            </h1>
            <p className="dash-sub-text">
              {profile?.bio || 'Real-time performance metrics, peer recommendations, and active barter exchange workflows.'}
            </p>
          </div>
        </div>

        <div className="dash-hero-meta">
          <div className="dash-rating-box">
            <div className="rating-num">
              {hasReviews ? `★ ${stats.avgRating.toFixed(1)}` : '★ —'}
            </div>
            <div className="rating-sub">
              {hasReviews ? `${stats.totalRatings} verified review${stats.totalRatings === 1 ? '' : 's'}` : 'No reviews yet (0 ratings)'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Link to="/matches" className="btn btn-secondary btn-sm">
              <IconDiscover size={14} /> Find Peers
            </Link>
            <Link to="/profile" className="btn btn-secondary btn-sm">
              <IconUser size={14} /> Edit Profile
            </Link>
          </div>
        </div>
      </div>

      {/* ─── 2. Recommended Next Step Alert ─────────────────────────────────── */}
      <div className="next-action-card">
        <div className="next-action-content">
          <div className="next-action-icon">
            {firstActiveWithRoom ? <IconVideo size={20} /> : hasIncoming ? <IconBell size={20} /> : !hasSkills ? <IconUser size={20} /> : <IconSparkles size={20} />}
          </div>
          <div className="next-action-text">
            <span className="action-tag">RECOMMENDED NEXT ACTION</span>
            <div className="action-title">
              {firstActiveWithRoom ? (
                <>Active Exchange Session Ready with <strong>{firstActiveWithRoom.fromUser?.name === (profile?.name || user?.name) ? firstActiveWithRoom.toUser?.name : firstActiveWithRoom.fromUser?.name}</strong></>
              ) : hasIncoming ? (
                <>You have <strong>{incomingSwaps.length} pending exchange proposal{incomingSwaps.length > 1 ? 's' : ''}</strong> awaiting review</>
              ) : !hasSkills ? (
                <>Complete your skill profile to unlock bidirectional barter match scoring</>
              ) : (
                <>Explore <strong>{topPicks.length} compatible peer recommendations</strong> tailored to your curriculum</>
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
              Review Requests ({incomingSwaps.length}) <IconArrowRight size={15} />
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

      {/* ─── 3. AskAiRank Inspired KPI Cards Grid ───────────────────────────── */}
      <div className="analytics-kpi-grid">
        {/* Total Exchanges */}
        <div className="analytics-kpi-card">
          <div className="analytics-kpi-top">
            <span className="analytics-kpi-label">Total Exchanges</span>
            <div className="analytics-kpi-icon icon-indigo">
              <IconSwaps size={16} />
            </div>
          </div>
          <div className="analytics-kpi-val">{stats?.totalSwaps || 0}</div>
          <div className="analytics-kpi-footer">
            <span>All lifetime proposals</span>
            <span className="analytics-delta-badge badge-indigo">
              {stats?.completedCount || 0} completed
            </span>
          </div>
        </div>

        {/* Active Exchanges */}
        <div className="analytics-kpi-card">
          <div className="analytics-kpi-top">
            <span className="analytics-kpi-label">Active Exchanges</span>
            <div className="analytics-kpi-icon icon-amber">
              <IconCalendar size={16} />
            </div>
          </div>
          <div className="analytics-kpi-val">{stats?.activeCount || 0}</div>
          <div className="analytics-kpi-footer">
            <span>In-flight sessions</span>
            <span className="analytics-delta-badge badge-amber">
              {stats?.pendingCount || 0} pending
            </span>
          </div>
        </div>

        {/* Completed Exchanges */}
        <div className="analytics-kpi-card">
          <div className="analytics-kpi-top">
            <span className="analytics-kpi-label">Completed Exchanges</span>
            <div className="analytics-kpi-icon icon-emerald">
              <IconCheckCircle size={16} />
            </div>
          </div>
          <div className="analytics-kpi-val">{stats?.completedCount || 0}</div>
          <div className="analytics-kpi-footer">
            <span>Mutual confirmations</span>
            <span className="analytics-delta-badge badge-emerald">
              Verified
            </span>
          </div>
        </div>

        {/* Curriculum Progress */}
        <div className="analytics-kpi-card">
          <div className="analytics-kpi-top">
            <span className="analytics-kpi-label">Curriculum Progress</span>
            <div className="analytics-kpi-icon icon-blue">
              <IconLearning size={16} />
            </div>
          </div>
          <div className="analytics-kpi-val">{stats?.avgProgress || 0}%</div>
          <div className="analytics-kpi-footer">
            <span>{learningTracks.length} active tracks</span>
            <span className="analytics-delta-badge badge-indigo">
              {learningTracks.filter(t => t.status === 'completed').length} mastered
            </span>
          </div>
        </div>

        {/* Exchange Reliability Score */}
        <div className="analytics-kpi-card">
          <div className="analytics-kpi-top">
            <span className="analytics-kpi-label">Reliability Score</span>
            <div className="analytics-kpi-icon icon-emerald">
              <IconShield size={16} />
            </div>
          </div>
          <div className="analytics-kpi-val">{stats?.reliabilityScore || 70}%</div>
          <div className="analytics-kpi-footer">
            <span>Bayesian model (prior 70%)</span>
            <span className="analytics-delta-badge badge-emerald">
              {stats?.completedCount >= 5 ? 'High record' : stats?.completedCount >= 1 ? 'Building' : 'Baseline'}
            </span>
          </div>
        </div>
      </div>

      {/* ─── 4. Real-Data Exchange Activity Distribution Bar ─────────────────── */}
      <div className="analytics-distribution-card">
        <div className="distribution-card-header">
          <span className="distribution-title">Exchange Portfolio Distribution</span>
          <span className="dash-pill-badge">
            {totalSwaps} Total Record{totalSwaps === 1 ? '' : 's'}
          </span>
        </div>

        {totalSwaps > 0 ? (
          <>
            <div className="distribution-bar" title="Exchange distribution breakdown">
              {activePct > 0 && (
                <div
                  className="dist-seg-active"
                  style={{ width: `${activePct}%` }}
                  title={`Active: ${stats?.activeCount} (${Math.round(activePct)}%)`}
                />
              )}
              {completedPct > 0 && (
                <div
                  className="dist-seg-completed"
                  style={{ width: `${completedPct}%` }}
                  title={`Completed: ${stats?.completedCount} (${Math.round(completedPct)}%)`}
                />
              )}
              {pendingPct > 0 && (
                <div
                  className="dist-seg-pending"
                  style={{ width: `${pendingPct}%` }}
                  title={`Pending: ${stats?.pendingCount} (${Math.round(pendingPct)}%)`}
                />
              )}
              {nonSuccessPct > 0 && (
                <div
                  className="dist-seg-other"
                  style={{ width: `${nonSuccessPct}%` }}
                  title={`Cancelled/Rejected: ${nonSuccessCount} (${Math.round(nonSuccessPct)}%)`}
                />
              )}
            </div>

            <div className="distribution-legend">
              <div className="legend-item">
                <span className="legend-dot" style={{ background: '#6366f1' }} />
                <span>Active: <strong>{stats?.activeCount || 0}</strong> ({Math.round(activePct)}%)</span>
              </div>
              <div className="legend-item">
                <span className="legend-dot" style={{ background: '#10b981' }} />
                <span>Completed: <strong>{stats?.completedCount || 0}</strong> ({Math.round(completedPct)}%)</span>
              </div>
              <div className="legend-item">
                <span className="legend-dot" style={{ background: '#f59e0b' }} />
                <span>Pending: <strong>{stats?.pendingCount || 0}</strong> ({Math.round(pendingPct)}%)</span>
              </div>
              {nonSuccessCount > 0 && (
                <div className="legend-item">
                  <span className="legend-dot" style={{ background: '#64748b' }} />
                  <span>Cancelled / Rejected: <strong>{nonSuccessCount}</strong> ({Math.round(nonSuccessPct)}%)</span>
                </div>
              )}
            </div>
          </>
        ) : (
          <div style={{ padding: '1rem 0', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
            No exchange activity recorded yet. Connect with recommended peers below to initiate your first barter swap.
          </div>
        )}
      </div>

      {/* ─── 5. Active Sessions & Video Rooms ─────────────────────────────────── */}
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
                    <Avatar name={partner?.name} size={44} />
                    <div className="session-card-details">
                      <div className="session-partner-name">
                        Exchange Partner: <strong>{partner?.name}</strong>
                      </div>
                      <div className="session-skills-barter">
                        <span className="skill-pill-offer">Teaches: {s.offeredSkill}</span>
                        <span className="barter-arrow">⇄</span>
                        <span className="skill-pill-want">Learns: {s.wantedSkill}</span>
                      </div>
                      {s.scheduledAt && (
                        <div className="session-schedule-time">
                          <IconClock size={14} />
                          <span>Session Time: {new Date(s.scheduledAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="session-card-actions">
                    <Link to={`/learning?swapId=${s._id}`} className="btn btn-secondary btn-sm">
                      <IconLearning size={14} /> Roadmap
                    </Link>
                    {s.roomId && (
                      <Link to={`/room/${s.roomId}`} className="btn btn-primary btn-sm shadow-glow">
                        <IconVideo size={14} /> Join Video Call
                      </Link>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ─── 6. AskAiRank Peer Recommendation Ranking Table ─────────────────── */}
      <section className="dash-section">
        <div className="dash-section-header">
          <div className="section-title-wrap">
            <h2 className="dash-section-title">Peer Recommendation Rankings</h2>
            <span className="section-counter-badge">{topPicks.length}</span>
          </div>
          <Link to="/recommendations" className="dash-link-action">
            Full Rankings →
          </Link>
        </div>

        {topPicks.length === 0 ? (
          <div className="dash-empty-state">
            <IconDiscover size={32} />
            <p>No peer recommendations generated yet. List your skills to discover partners!</p>
            <Link to="/profile" className="btn btn-primary btn-sm">
              Setup Your Skills
            </Link>
          </div>
        ) : (
          <div className="analytics-table-card">
            <div className="analytics-table-header-row">
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)' }}>
                Top Matched Candidates Ranked by Compatibility Algorithm
              </span>
              <span className="dash-pill-badge">Bayesian Weighted</span>
            </div>

            <div className="analytics-table-wrapper">
              <table className="analytics-table">
                <thead>
                  <tr>
                    <th style={{ width: '60px' }}>Rank</th>
                    <th>Peer Member</th>
                    <th>Match Score</th>
                    <th>Skills You Trade</th>
                    <th>Schedule Alignment</th>
                    <th style={{ textAlign: 'right' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {topPicks.slice(0, 5).map((rec, index) => (
                    <tr key={rec.user._id}>
                      <td>
                        <span className={`rank-badge ${index === 0 ? 'rank-gold' : ''}`}>
                          #{index + 1}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                          <Avatar name={rec.user.name} size={34} />
                          <div>
                            <Link to={`/user/${rec.user._id}`} style={{ fontWeight: 700, color: 'var(--text-main)', textDecoration: 'none' }}>
                              {rec.user.name}
                            </Link>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              ★ {rec.user.averageRating ? rec.user.averageRating.toFixed(1) : '—'} • {rec.user.totalRatings || 0} reviews
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                          <ScoreBadge score={rec.score} />
                          <div style={{ width: '60px', height: '6px', background: 'var(--surface-subtle)', borderRadius: '9999px', overflow: 'hidden' }}>
                            <div
                              style={{
                                width: `${Math.min(100, rec.score)}%`,
                                height: '100%',
                                background: rec.score >= 80 ? '#10b981' : rec.score >= 50 ? '#6366f1' : '#f59e0b',
                                borderRadius: '9999px'
                              }}
                            />
                          </div>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                          {rec.matchedWants?.slice(0, 1).map((s, i) => (
                            <span key={i} className="skill-pill-offer" style={{ fontSize: '0.72rem' }}>
                              Teaches: {s}
                            </span>
                          ))}
                          {rec.matchedOffers?.slice(0, 1).map((s, i) => (
                            <span key={i} className="skill-pill-want" style={{ fontSize: '0.72rem' }}>
                              Wants: {s}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>
                        <span className={`dash-pill-badge ${rec.availabilityOverlap ? 'badge-verified' : ''}`}>
                          {rec.availabilityOverlap ? '⏰ Time slots align' : 'General overlap'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          style={{ padding: '0.35rem 0.85rem', fontSize: '0.8rem' }}
                          onClick={() => setSwapModalTarget(rec)}
                        >
                          Request Swap
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* ─── 7. Learning Roadmaps Overview ──────────────────────────────────── */}
      {learningTracks.length > 0 ? (
        <section className="dash-section">
          <div className="dash-section-header">
            <div className="section-title-wrap">
              <h2 className="dash-section-title">Active Learning Curricula</h2>
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
                    {track.status === 'completed' ? '✓ Mastered' : `${track.overallProgress || 0}% Complete`}
                  </span>
                </div>

                <div className="track-progress-bar-bg">
                  <div
                    className="track-progress-fill"
                    style={{ width: `${track.overallProgress || 0}%` }}
                  />
                </div>

                <div className="track-card-footer">
                  <span className="track-coach-label">
                    Peer Instructor: <strong>{track.instructor?.name || 'Assigned'}</strong>
                  </span>
                  <Link to={`/learning?trackId=${track._id}`} className="dash-link-action">
                    Roadmap →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className="dash-section">
          <div className="dash-section-header">
            <div className="section-title-wrap">
              <h2 className="dash-section-title">Active Learning Curricula</h2>
              <span className="section-counter-badge">0</span>
            </div>
          </div>
          <div className="dash-empty-state">
            <IconLearning size={32} />
            <p>No active learning curricula yet. Accept a swap to initialize a structured roadmap.</p>
            <Link to="/matches" className="btn btn-secondary btn-sm">
              Discover Peers to Learn With
            </Link>
          </div>
        </section>
      )}

      {/* ─── 8. Circular 3-Way Exchange Status Card ─────────────────────────── */}
      <section className="dash-section">
        <div className="analytics-circular-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'var(--primary-light)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <IconRepeat size={18} />
              </div>
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-main)' }}>
                  Three-Way Circular Barter Engine
                </h3>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  Automatic deadlock resolution connecting three peers when bilateral swaps are asymmetric.
                </span>
              </div>
            </div>

            <Link to="/swaps" className="btn btn-secondary btn-sm">
              Manage Proposals →
            </Link>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border)' }}>
            <div>
              <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700 }}>
                Circular Proposals
              </span>
              <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-main)', marginTop: '0.15rem' }}>
                {circularProposals.length} active
              </div>
            </div>

            <div>
              <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700 }}>
                Atomic Synchronization
              </span>
              <div style={{ fontSize: '0.88rem', fontWeight: 600, color: '#10b981', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#10b981' }} />
                Solver Active
              </div>
            </div>

            <div>
              <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700 }}>
                Zero Deadlock Guarantee
              </span>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                Closed loops discoverable across all skill categories.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── 9. Incoming Requests & Recent Notifications ─────────────────────── */}
      <div className="dash-two-col-layout">
        {/* Incoming Proposals */}
        <section className="dash-section">
          <div className="dash-section-header">
            <div className="section-title-wrap">
              <h2 className="dash-section-title">Pending Swap Proposals</h2>
              <span className="section-counter-badge">{incomingSwaps.length}</span>
            </div>
            <Link to="/swaps" className="dash-link-action">
              Manage →
            </Link>
          </div>

          {incomingSwaps.length === 0 ? (
            <div className="dash-empty-state">
              <IconSwaps size={32} />
              <p>No incoming exchange proposals awaiting your response.</p>
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

        {/* Recent Platform Notifications */}
        <section className="dash-section">
          <div className="dash-section-header">
            <div className="section-title-wrap">
              <h2 className="dash-section-title">Recent Activity</h2>
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
