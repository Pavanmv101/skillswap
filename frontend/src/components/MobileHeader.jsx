import React from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useNotification } from '../context/NotificationContext'
import Avatar from './Avatar'
import { IconLogo, IconMenu, IconSun, IconMoon, IconBell } from './Icons'

export default function MobileHeader({ onOpenSidebar }) {
  const { user } = useAuth()
  const { isDark, toggleTheme } = useTheme()
  const { unreadCount } = useNotification()

  return (
    <header className="mobile-header">
      <div className="mobile-header-left">
        <button
          type="button"
          className="mobile-header-menu-btn"
          onClick={onOpenSidebar}
          aria-label="Open navigation menu"
        >
          <IconMenu size={22} />
        </button>

        <Link to="/dashboard" className="mobile-header-brand">
          <IconLogo size={26} />
          <span className="brand-name">SkillSwap</span>
        </Link>
      </div>

      <div className="mobile-header-right">
        {/* Quick Theme Toggle */}
        <button
          type="button"
          className="header-icon-btn"
          onClick={toggleTheme}
          aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          title={isDark ? 'Light mode' : 'Dark mode'}
        >
          {isDark ? <IconSun size={18} /> : <IconMoon size={18} />}
        </button>

        {/* Notifications Icon with Badge */}
        <Link
          to="/notifications"
          className="header-icon-btn notif-btn"
          aria-label="Notifications"
          title="Notifications"
        >
          <IconBell size={19} />
          {unreadCount > 0 && (
            <span className="header-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
          )}
        </Link>

        {/* User Profile Avatar */}
        <Link to="/profile" className="mobile-header-avatar" title="My Profile">
          <Avatar name={user?.name || 'User'} size={30} />
        </Link>
      </div>
    </header>
  )
}
