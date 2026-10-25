import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../api/axios'
import { useAuth } from '../context/AuthContext'
import Spinner from '../components/Spinner'

export default function Dashboard() {
  const { user } = useAuth()
  const [stats, setStats]     = useState(null)
  const [pending, setPending] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const [profileRes, swapsRes, matchRes] = await Promise.all([
          api.get('/profile'),
          api.get('/swap'),
          api.get('/match'),
        ])

        const profile = profileRes.data
        const swaps   = swapsRes.data
        const matches = matchRes.data.matches || []

        // Stats
        const pendingSwaps   = swaps.filter(s => s.status === 'pending')
        const activeSwaps    = swaps.filter(s => s.status === 'accepted')
        const completedSwaps = swaps.filter(s => s.status === 'completed')

        setStats({
          skillsOffered:  profile.skillsOffered?.length  || 0,
          skillsWanted:   profile.skillsWanted?.length   || 0,
          matchCount:     matches.length,
          pendingCount:   pendingSwaps.length,
          activeCount:    activeSwaps.length,
          completedCount: completedSwaps.length,
          avgRating:      profile.averageRating || 0,
          totalRatings:   profile.totalRatings  || 0,
        })

        // Pending swaps sent TO me
        const incoming = pendingSwaps.filter(s => s.toUser?._id === user?.id || s.toUser === user?.id)
        setPending(incoming.slice(0, 5))
      } catch (err) {
        console.error('Dashboard load error:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [user])

  if (loading) return <Spinner message="Loading dashboard…" />

  return (
    <div className="page">
      <h2>Welcome back, {user?.name || 'User'}! 👋</h2>

      {/* Stats Grid */}
      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-number">{stats?.skillsOffered}</span>
          <span className="stat-label">Skills Offered</span>
        </div>
        <div className="stat-card">
          <span className="stat-number">{stats?.skillsWanted}</span>
          <span className="stat-label">Skills Wanted</span>
        </div>
        <div className="stat-card">
          <span className="stat-number">{stats?.matchCount}</span>
          <span className="stat-label">Matches</span>
        </div>
        <div className="stat-card">
          <span className="stat-number">{stats?.pendingCount}</span>
          <span className="stat-label">Pending</span>
        </div>
        <div className="stat-card">
          <span className="stat-number">{stats?.activeCount}</span>
          <span className="stat-label">Active</span>
        </div>
        <div className="stat-card">
          <span className="stat-number">{stats?.completedCount}</span>
          <span className="stat-label">Completed</span>
        </div>
        <div className="stat-card">
          <span className="stat-number">⭐ {stats?.avgRating?.toFixed(1)}</span>
          <span className="stat-label">{stats?.totalRatings} rating(s)</span>
        </div>
      </div>

      {/* Quick Actions */}
      <h3 style={{ marginTop: '2rem' }}>Quick Actions</h3>
      <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap', marginTop: '.75rem' }}>
        <Link to="/profile" className="btn btn-primary">Edit Profile</Link>
        <Link to="/matches" className="btn btn-accent">Find Matches</Link>
        <Link to="/swaps"   className="btn btn-muted">My Swaps</Link>
      </div>

      {/* Pending Incoming Alerts */}
      {pending.length > 0 && (
        <div style={{ marginTop: '2rem' }}>
          <h3>🔔 Pending Requests for You</h3>
          <div className="card-list" style={{ marginTop: '.75rem' }}>
            {pending.map(s => (
              <div className="card" key={s._id}>
                <p><strong>{s.fromUser?.name || 'Someone'}</strong> wants to swap</p>
                <p style={{ fontSize: '.85rem', color: 'var(--text-muted)' }}>
                  Offering <strong>{s.offeredSkill}</strong> for your <strong>{s.wantedSkill}</strong>
                </p>
                <Link to="/swaps" className="btn btn-primary" style={{ marginTop: '.5rem' }}>View Swaps</Link>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
