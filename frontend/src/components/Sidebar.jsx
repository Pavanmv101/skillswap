import { useState, useEffect } from 'react'
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useNotification } from '../context/NotificationContext'
import Avatar from './Avatar'
import api from '../api/axios'
import {
  IconDashboard,
  IconDiscover,
  IconSparkles,
  IconSwaps,
  IconLearning,
  IconBell,
  IconUser,
  IconShield,
  IconSun,
  IconMoon,
  IconLogout,
  IconChevronLeft,
  IconChevronRight,
  IconLogo,
  IconX
} from './Icons'

export default function Sidebar({ mobileOpen = false, onMobileClose = () => {} }) {
  const { user, logout } = useAuth()
  const { theme, toggleTheme, isDark } = useTheme()
  const { unreadCount } = useNotification()
  const navigate = useNavigate()
  const location = useLocation()

  // Collapsed state stored in localStorage for desktop
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('skillswap-sidebar-collapsed') === 'true'
    } catch (_) {
      return false
    }
  })

  // Pending swap proposals count
  const [pendingSwapCount, setPendingSwapCount] = useState(0)

  useEffect(() => {
    try {
      localStorage.setItem('skillswap-sidebar-collapsed', collapsed)
    } catch (_) {}
  }, [collapsed])

  useEffect(() => {
    let mounted = true
    async function checkPending() {
      try {
        const { data } = await api.get('/swap')
        if (!mounted) return
        const uid = user?._id || user?.id
        const incoming = (data || []).filter(
          s => s.status === 'pending' && (s.toUser?._id === uid || s.toUser === uid)
        )
        setPendingSwapCount(incoming.length)
      } catch (_) {}
    }
    checkPending()
    const interval = setInterval(checkPending, 30000)
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [user])

  // Close mobile drawer on route change
  useEffect(() => {
    onMobileClose()
  }, [location.pathname])

  function handleLogout() {
    logout()
    navigate('/')
  }

  const navItems = [
    { to: '/dashboard', label: 'Dashboard', icon: IconDashboard },
    { to: '/matches', label: 'Discover Peers', icon: IconDiscover },
    { to: '/recommendations', label: 'For You', icon: IconSparkles, badge: 'TOP' },
    { to: '/swaps', label: 'My Swaps', icon: IconSwaps, count: pendingSwapCount },
    { to: '/learning', label: 'Learning Centre', icon: IconLearning },
    { to: '/notifications', label: 'Notifications', icon: IconBell, count: unreadCount },
    { to: '/profile', label: 'Profile', icon: IconUser },
  ]

  if (user?.role === 'admin') {
    navItems.push({ to: '/admin', label: 'Verifications', icon: IconShield, admin: true })
  }

  return (
    <>
      {/* Mobile Backdrop Overlay */}
      {mobileOpen && (
        <div 
          className="sidebar-backdrop" 
          onClick={onMobileClose} 
          aria-hidden="true" 
        />
      )}

      <aside className={`app-sidebar ${collapsed ? 'sidebar-collapsed' : ''} ${mobileOpen ? 'sidebar-mobile-open' : ''}`}>
        {/* Brand Header */}
        <div className="sidebar-header">
          <Link to="/dashboard" className="sidebar-brand" title="SkillSwap">
            <IconLogo size={28} className="sidebar-logo" />
            {!collapsed && (
              <div className="sidebar-brand-text">
                <span className="brand-name">SkillSwap</span>
                <span className="brand-badge">SaaS</span>
              </div>
            )}
          </Link>

          {/* Desktop Collapse Toggle */}
          <button
            type="button"
            className="sidebar-collapse-btn desktop-only"
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <IconChevronRight size={16} /> : <IconChevronLeft size={16} />}
          </button>

          {/* Mobile Close Button */}
          <button
            type="button"
            className="sidebar-close-btn mobile-only"
            onClick={onMobileClose}
            aria-label="Close navigation"
          >
            <IconX size={20} />
          </button>
        </div>

        {/* Navigation Links */}
        <div className="sidebar-nav-wrap">
          {!collapsed && <div className="sidebar-section-title">NAVIGATION</div>}
          <nav className="sidebar-nav">
            {navItems.map(item => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => `sidebar-link ${isActive ? 'active' : ''}`}
                  title={collapsed ? item.label : undefined}
                >
                  <span className="sidebar-icon-wrap">
                    <Icon size={19} />
                    {collapsed && item.count > 0 && (
                      <span className="sidebar-mini-dot" />
                    )}
                  </span>
                  
                  {!collapsed && (
                    <>
                      <span className="sidebar-link-text">{item.label}</span>
                      {item.badge && (
                        <span className="sidebar-pill-badge">{item.badge}</span>
                      )}
                      {item.count > 0 && (
                        <span className="sidebar-count-badge">{item.count}</span>
                      )}
                    </>
                  )}
                </NavLink>
              )
            })}
          </nav>
        </div>

        {/* Bottom Preferences & User Profile */}
        <div className="sidebar-footer">
          {/* Theme Toggle Button */}
          <button
            type="button"
            className="sidebar-footer-btn"
            onClick={toggleTheme}
            title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            aria-label="Toggle visual theme"
          >
            <span className="sidebar-icon-wrap">
              {isDark ? <IconSun size={18} /> : <IconMoon size={18} />}
            </span>
            {!collapsed && (
              <span className="sidebar-link-text">
                {isDark ? 'Light Mode' : 'Dark Mode'}
              </span>
            )}
          </button>

          {/* User Identity Pill */}
          <div className="sidebar-user-card" title={user?.name || 'My Account'}>
            <Link to="/profile" className="sidebar-user-link">
              <Avatar name={user?.name || 'User'} size={collapsed ? 34 : 36} />
              {!collapsed && (
                <div className="sidebar-user-info">
                  <div className="sidebar-user-name">{user?.name}</div>
                  <div className="sidebar-user-role">{user?.role === 'admin' ? 'Administrator' : 'Student Peer'}</div>
                </div>
              )}
            </Link>

            {!collapsed && (
              <button
                type="button"
                className="sidebar-logout-btn"
                onClick={handleLogout}
                title="Sign out of SkillSwap"
                aria-label="Log out"
              >
                <IconLogout size={16} />
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  )
}
