import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useNotification } from '../context/NotificationContext'
import Spinner from '../components/Spinner'

export function getNotificationIcon(type) {
  switch (type) {
    case 'SWAP_REQUEST':       return '⚡'
    case 'SWAP_ACCEPTED':      return '🚀'
    case 'SWAP_REJECTED':      return '❌'
    case 'SWAP_CANCELLED':     return '🚫'
    case 'SWAP_COMPLETED':     return '⭐'
    case 'SESSION_SCHEDULED':  return '📅'
    case 'SESSION_RESCHEDULED':return '🔄'
    case 'SESSION_REMINDER':   return '⏰'
    default:                   return '🔔'
  }
}

export function formatTimeAgo(dateString) {
  if (!dateString) return ''
  const date = new Date(dateString)
  const now = new Date()
  const seconds = Math.floor((now - date) / 1000)

  if (seconds < 45) return 'Just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export default function Notifications() {
  const navigate = useNavigate()
  const {
    notifications,
    unreadCount,
    loading,
    markAsRead,
    markAllAsRead,
    deleteNotification,
    clearAllNotifications,
  } = useNotification()

  const [filter, setFilter] = useState('all') // 'all' or 'unread'

  const filtered = notifications.filter(n => {
    if (filter === 'unread') return !n.isRead
    return true
  })

  function handleNotificationClick(n) {
    if (!n.isRead) {
      markAsRead(n._id)
    }

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

  return (
    <div className="page" style={{ maxWidth: 840 }}>
      {/* Page Header */}
      <div className="page-header-flex">
        <div>
          <h2 className="page-title">Notification Center</h2>
          <p className="page-sub">
            Real-time updates on your skill proposals, video sessions, and peer reminders.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
          {unreadCount > 0 && (
            <button className="btn btn-muted btn-sm" onClick={markAllAsRead}>
              ✓ Mark All Read
            </button>
          )}
          {notifications.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={clearAllNotifications}>
              🗑️ Clear All
            </button>
          )}
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="tabs-bar" style={{ marginBottom: '1.25rem' }}>
        <button
          className={`tab-btn ${filter === 'all' ? 'tab-btn-active' : ''}`}
          onClick={() => setFilter('all')}
        >
          All Updates
          <span className="tab-counter">{notifications.length}</span>
        </button>
        <button
          className={`tab-btn ${filter === 'unread' ? 'tab-btn-active' : ''}`}
          onClick={() => setFilter('unread')}
        >
          Unread
          {unreadCount > 0 && (
            <span className="tab-counter tab-counter-active">{unreadCount}</span>
          )}
        </button>
      </div>

      {/* Content */}
      {loading && notifications.length === 0 ? (
        <Spinner message="Loading notifications…" />
      ) : filtered.length === 0 ? (
        <div className="empty-card">
          <div className="empty-icon">{filter === 'unread' ? '✨' : '🔔'}</div>
          <h3>{filter === 'unread' ? 'All caught up!' : 'No notifications yet'}</h3>
          <p style={{ maxWidth: 440, margin: '.5rem auto 1.5rem', color: 'var(--text-muted)' }}>
            {filter === 'unread'
              ? 'You have read all your updates. New swap proposals and session reminders will appear here.'
              : 'When students request swaps, accept proposals, or schedule sessions, you will be alerted instantly in real time.'}
          </p>
          <Link to="/matches" className="btn btn-primary shadow-glow">
            Explore Skill Matches →
          </Link>
        </div>
      ) : (
        <div className="card-list">
          {filtered.map(n => (
            <div
              key={n._id}
              className={`card notification-card ${!n.isRead ? 'notif-unread' : ''}`}
              onClick={() => handleNotificationClick(n)}
            >
              <div className="notif-icon-col">
                <span className="notif-type-badge">{getNotificationIcon(n.type)}</span>
              </div>

              <div className="notif-content-col">
                <div className="notif-header-row">
                  <span className="notif-title">{n.title}</span>
                  <span className="notif-time">{formatTimeAgo(n.createdAt)}</span>
                </div>
                <p className="notif-message">{n.message}</p>

                {n.relatedSwap && (
                  <div className="notif-action-hint">
                    {n.type === 'SESSION_REMINDER'
                      ? '🎥 Click to join video room →'
                      : '📋 Click to view in Barter Hub →'}
                  </div>
                )}
              </div>

              <div className="notif-actions-col">
                {!n.isRead && (
                  <button
                    type="button"
                    className="notif-read-indicator-btn"
                    title="Mark as read"
                    onClick={(e) => {
                      e.stopPropagation()
                      markAsRead(n._id)
                    }}
                  >
                    ●
                  </button>
                )}
                <button
                  type="button"
                  className="notif-delete-btn"
                  title="Delete notification"
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteNotification(n._id)
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
