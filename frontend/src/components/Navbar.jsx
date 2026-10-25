import { useEffect, useState } from 'react'
import { NavLink, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import Avatar from './Avatar'
import api from '../api/axios'

export default function Navbar() {
  const { token, user, logout } = useAuth()
  const navigate = useNavigate()
  const [pendingCount, setPendingCount] = useState(0)
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    if (!token) {
      setPendingCount(0)
      return
    }

    async function checkPending() {
      try {
        const { data } = await api.get('/swap')
        const incoming = (data || []).filter(
          s => s.status === 'pending' && (s.toUser?._id === user?.id || s.toUser === user?.id)
        )
        setPendingCount(incoming.length)
      } catch (err) {
        // quiet fallback
      }
    }

    checkPending()
    const interval = setInterval(checkPending, 30000)
    return () => clearInterval(interval)
  }, [token, user])

  function handleLogout() {
    logout()
    navigate('/')
  }

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <Link to={token ? '/dashboard' : '/'} className="navbar-brand">
          <span className="brand-logo">⚡</span>
          <span className="brand-text">SkillSwap</span>
        </Link>

        {token ? (
          <>
            <div className={`navbar-links ${mobileOpen ? 'mobile-show' : ''}`}>
              <NavLink to="/dashboard" onClick={() => setMobileOpen(false)}>
                Dashboard
              </NavLink>
              <NavLink to="/matches" onClick={() => setMobileOpen(false)}>
                Find Matches
              </NavLink>
              <NavLink to="/swaps" onClick={() => setMobileOpen(false)} className="nav-swap-link">
                My Swaps
                {pendingCount > 0 && <span className="nav-badge-pill">{pendingCount}</span>}
              </NavLink>
              <NavLink to="/profile" onClick={() => setMobileOpen(false)}>
                Profile
              </NavLink>
            </div>

            <div className="navbar-right">
              <Link to="/profile" className="navbar-profile-pill" title="View profile">
                <Avatar name={user?.name || 'User'} size={32} />
                <span className="navbar-username">{user?.name}</span>
              </Link>
              <button className="btn btn-ghost btn-sm" onClick={handleLogout}>
                Log out
              </button>
              <button
                className="mobile-toggle"
                onClick={() => setMobileOpen(!mobileOpen)}
                aria-label="Toggle menu"
              >
                {mobileOpen ? '✕' : '☰'}
              </button>
            </div>
          </>
        ) : (
          <div className="navbar-right">
            <Link to="/login" className="btn btn-muted btn-sm">Sign In</Link>
            <Link to="/register" className="btn btn-primary btn-sm">Get Started</Link>
          </div>
        )}
      </div>
    </nav>
  )
}
