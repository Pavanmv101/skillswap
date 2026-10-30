import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { io } from 'socket.io-client'
import api from '../api/axios'
import { useAuth } from './AuthContext'
import { useToast } from './ToastContext'

const NotificationContext = createContext(null)

export function NotificationProvider({ children }) {
  const { token, user } = useAuth()
  const { addToast } = useToast()

  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount]     = useState(0)
  const [loading, setLoading]             = useState(false)
  const socketRef                         = useRef(null)

  // Fetch initial notifications and unread count from API
  const refreshNotifications = useCallback(async () => {
    if (!token) {
      setNotifications([])
      setUnreadCount(0)
      return
    }

    try {
      setLoading(true)
      const [listRes, countRes] = await Promise.all([
        api.get('/notifications?limit=25'),
        api.get('/notifications/unread-count'),
      ])
      setNotifications(listRes.data.notifications || [])
      setUnreadCount(countRes.data.unreadCount || 0)
    } catch (err) {
      console.warn('Failed to load notifications:', err.message)
    } finally {
      setLoading(false)
    }
  }, [token])

  // Establish persistent, authenticated Socket.io connection
  useEffect(() => {
    if (!token) {
      if (socketRef.current) {
        socketRef.current.disconnect()
        socketRef.current = null
      }
      setNotifications([])
      setUnreadCount(0)
      return
    }

    refreshNotifications()

    const socketUrl =
      import.meta.env.VITE_SOCKET_URL ||
      (import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace(/\/api\/?$/, '') : '') ||
      (window.location.hostname === 'localhost' ? 'http://localhost:5001' : window.location.origin)
    const socket = io(socketUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 2000,
    })
    socketRef.current = socket

    socket.on('connect', () => {
      console.log('[Socket.io] Real-time notification channel connected')
      // Also send authenticate explicitly for backward compatibility
      socket.emit('authenticate', token)
    })

    // Handle incoming real-time notifications
    socket.on('notification:new', (notif) => {
      console.log('[Socket.io] Inbound notification received:', notif)
      setNotifications(prev => [notif, ...prev])
      setUnreadCount(prev => prev + 1)

      // Surface non-intrusive lightweight toast feedback
      addToast(`${notif.title}: ${notif.message}`, 'info')
    })

    socket.on('disconnect', (reason) => {
      console.log('[Socket.io] Notification socket disconnected:', reason)
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [token, addToast, refreshNotifications])

  // Mark single notification as read
  const markAsRead = async (id) => {
    try {
      await api.put(`/notifications/${id}/read`)
      setNotifications(prev =>
        prev.map(n => (n._id === id ? { ...n, isRead: true } : n))
      )
      setUnreadCount(prev => Math.max(0, prev - 1))
    } catch (err) {
      console.error('Failed to mark notification as read:', err)
    }
  }

  // Mark all notifications as read
  const markAllAsRead = async () => {
    try {
      await api.put('/notifications/read-all')
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })))
      setUnreadCount(0)
      addToast('All notifications marked as read', 'info')
    } catch (err) {
      console.error('Failed to mark all as read:', err)
    }
  }

  // Delete individual notification
  const deleteNotification = async (id) => {
    try {
      const target = notifications.find(n => n._id === id)
      await api.delete(`/notifications/${id}`)
      setNotifications(prev => prev.filter(n => n._id !== id))
      if (target && !target.isRead) {
        setUnreadCount(prev => Math.max(0, prev - 1))
      }
    } catch (err) {
      console.error('Failed to delete notification:', err)
    }
  }

  // Clear all notifications
  const clearAllNotifications = async () => {
    try {
      await api.delete('/notifications')
      setNotifications([])
      setUnreadCount(0)
      addToast('Notification history cleared', 'info')
    } catch (err) {
      console.error('Failed to clear notifications:', err)
    }
  }

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        loading,
        markAsRead,
        markAllAsRead,
        deleteNotification,
        clearAllNotifications,
        refreshNotifications,
      }}
    >
      {children}
    </NotificationContext.Provider>
  )
}

export function useNotification() {
  const ctx = useContext(NotificationContext)
  if (!ctx) {
    return {
      notifications: [],
      unreadCount: 0,
      loading: false,
      markAsRead: () => {},
      markAllAsRead: () => {},
      deleteNotification: () => {},
      clearAllNotifications: () => {},
      refreshNotifications: () => {},
    }
  }
  return ctx
}
