import { useEffect, useState, useRef } from 'react'
import { NavLink, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useNotification } from '../context/NotificationContext'
import { getNotificationIcon, formatTimeAgo } from '../pages/Notifications'
import Avatar from './Avatar'
import api from '../api/axios'

export default function Navbar() {
  const { token, user, logout } = useAuth()
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotification()
  const navigate = useNavigate()

  const [pendingSwapCount, setPendingSwapCount] = useState(0)
  const [mobileOpen, setMobileOpen]             = useState(false)
  const [dropdownOpen, setDropdownOpen]         = useState(false)
  const dropdownRef                             = useRef(null)

  // Poll for incoming pending swaps count (every 30s)
  useEffect(() => {
    if (!token) {
      setPendingSwapCount(0)
      return
    }

    async function checkPending() {
      try {
        const { data } = await api.get('/swap')
        const incoming = (data || []).filter(
          s => s.status === 'pending' && (s.toUser?._id === user?.id || s.toUser === user?.id)
        )
        setPendingSwapCount(incoming.length)
      } catch (err) {
        // quiet fallback
      }
    }

    checkPending()
    const interval = setInterval(checkPending, 30000)
    return () => clearInterval(interval)
  }, [token, user])

  // Close notification dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function handleLogout() {
    logout()
    navigate('/')
  }

  function handleNotificationItemClick(n) {
    if (!n.isRead) {
      markAsRead(n._id)
    }
    setDropdownOpen(false)

    if (n.relatedSwap) {
      if (n.relatedSwap.status === 'accepted' && n.relatedSwap.roomId && n.type === 'SESSION_REMINDER') {
        navigate(`/room/${n.relatedSwap.roomId}`)
      } else {
        navigate('/swaps')
      }
    } else {
      navigate('/swaps')
    }
  }

  // Preview the 5 most recent notifications in dropdown
  const recentNotifications = notifications.slice(0, 5)

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
                {pendingSwapCount > 0 && <span className="nav-badge-pill">{pendingSwapCount}</span>}
              </NavLink>
              <NavLink to="/profile" onClick={() => setMobileOpen(false)}>
                Profile
              </NavLink>
            </div>

            <div className="navbar-right">
              {/* Notification Bell Dropdown */}
              <div className="nav-notification-wrapper" ref={dropdownRef}>
                <button
                  type="button"
                  className={`nav-bell-btn ${unreadCount > 0 ? 'has-unread' : ''}`}
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  aria-label="View notifications"
                  title="Notifications"
                >
                  <span className="bell-icon">🔔</span>
                  {unreadCount > 0 && (
                    <span className="nav-notif-badge">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </button>

                {/* Dropdown Menu */}
                {dropdownOpen && (
                  <div className="nav-notif-dropdown">
                    <div className="dropdown-header">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                        <strong>Notifications</strong>
                        {unreadCount > 0 && (
                          <span className="dropdown-count-tag">{unreadCount} new</span>
                        )}
                      </div>
                      {unreadCount > 0 && (
                        <button
                          type="button"
                          className="link-subtle"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '.75rem' }}
                          onClick={markAllAsRead}
                        >
                          Mark all read
                        </button>
                      )}
                    </div>

                    <div className="dropdown-list">
                      {recentNotifications.length === 0 ? (
                        <div className="dropdown-empty">
                          <span>✨ No notifications right now</span>
                        </div>
                      ) : (
                        recentNotifications.map(n => (
                          <div
                            key={n._id}
                            className={`dropdown-item ${!n.isRead ? 'dropdown-item-unread' : ''}`}
                            onClick={() => handleNotificationItemClick(n)}
                          >
                            <span className="dropdown-item-icon">
                              {getNotificationIcon(n.type)}
                            </span>
                            <div className="dropdown-item-content">
                              <div className="dropdown-item-title-row">
                                <span className="dropdown-item-title">{n.title}</span>
                                <span className="dropdown-item-time">{formatTimeAgo(n.createdAt)}</span>
                              </div>
                              <p className="dropdown-item-msg">{n.message}</p>
                            </div>
                            {!n.isRead && <span className="dropdown-unread-dot" />}
                          </div>
                        ))
                      )}
                    </div>

                    <div className="dropdown-footer">
                      <Link
                        to="/notifications"
                        className="dropdown-view-all"
                        onClick={() => setDropdownOpen(false)}
                      >
                        View all notifications →
                      </Link>
                    </div>
                  </div>
                )}
              </div>

              {/* User Avatar Profile Pill */}
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
