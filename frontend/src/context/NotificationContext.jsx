import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react'
import { io } from 'socket.io-client'
import api from '../api/axios'
import { useAuth } from './AuthContext'
import { useToast } from './ToastContext'

const NotificationContext = createContext(null)

const MAX_ID_ATTEMPTS = 3
const MAX_RECONCILE_BATCH = 100

export function NotificationProvider({ children }) {
  const { token } = useAuth()
  const { addToast } = useToast()

  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount]     = useState(0)
  const [loading, setLoading]             = useState(false)
  const socketRef                         = useRef(null)

  // Synchronous and generation-scoped tracking refs
  const notificationsRef          = useRef([])
  const unreadIdsRef              = useRef(new Set())
  const inFlightReadIdsRef        = useRef(new Set())
  const locallyReadIdsRef         = useRef(new Set())
  const localReadsStateRef        = useRef(new Map()) // Map<string, { status: 'pending' | 'confirmed' | 'failed' }>
  const seenNotificationIdsRef    = useRef(new Set())

  const refreshGenerationRef      = useRef(0)
  const activeRefreshGenRef       = useRef(null)
  const generationSocketBufferRef = useRef(new Map()) // Map<number, Map<string, notif>>
  const coordinatorsRef           = useRef(new Map()) // Map<number, GenerationCoordinator>

  // Dedicated useEffect to purely synchronize notificationsRef and unreadIdsRef with committed state
  useEffect(() => {
    notificationsRef.current = notifications
    const nextUnread = new Set()
    notifications.forEach((n) => {
      if (!n.isRead && n._id) {
        nextUnread.add(n._id.toString())
      }
    })
    unreadIdsRef.current = nextUnread
  }, [notifications])

  // Reset all session state on user logout or session switch
  const resetNotificationState = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect()
      socketRef.current = null
    }
    setNotifications([])
    setUnreadCount(0)
    notificationsRef.current = []
    unreadIdsRef.current.clear()
    inFlightReadIdsRef.current.clear()
    locallyReadIdsRef.current.clear()
    localReadsStateRef.current.clear()
    seenNotificationIdsRef.current.clear()
    refreshGenerationRef.current = 0
    activeRefreshGenRef.current = null
    generationSocketBufferRef.current.clear()
    coordinatorsRef.current.clear()
  }, [])

  // Generation-scoped reconciliation coordinator runner
  const runGenerationCoordinator = useCallback(async (gen) => {
    const coordinator = coordinatorsRef.current.get(gen)
    if (!coordinator || coordinator.isRunning || coordinator.isCompleted) return
    if (gen !== refreshGenerationRef.current) return

    coordinator.isRunning = true

    try {
      while (coordinator.queue.length > 0) {
        if (gen !== refreshGenerationRef.current) {
          coordinator.isCompleted = true
          coordinatorsRef.current.delete(gen)
          break
        }

        const batch = coordinator.queue.slice(0, MAX_RECONCILE_BATCH)
        const batchIds = batch.map((item) => item.id)

        try {
          const res = await api.get('/notifications/unread-count', {
            params: { reconcileIds: batchIds.join(',') },
          })

          if (gen !== refreshGenerationRef.current) {
            coordinator.isCompleted = true
            coordinatorsRef.current.delete(gen)
            break
          }

          coordinator.networkRetries = 0
          let authoritativeUnread = Number(res.data?.unreadCount || 0)
          const existSet = new Set(res.data?.reconciledNotificationIds || [])
          const unreadSet = new Set(res.data?.reconciledUnreadIds || [])

          const resolvedIds = new Set()
          batch.forEach((item) => {
            if (item.type === 'local_read') {
              if (existSet.has(item.id)) {
                if (unreadSet.has(item.id)) {
                  // Still unread on server snapshot: subtract from count
                  authoritativeUnread = Math.max(0, authoritativeUnread - 1)
                } else {
                  // Confirmed read by server
                  locallyReadIdsRef.current.delete(item.id)
                  localReadsStateRef.current.delete(item.id)
                }
                resolvedIds.add(item.id)
              } else {
                item.attempts += 1
                if (item.attempts >= MAX_ID_ATTEMPTS) {
                  locallyReadIdsRef.current.delete(item.id)
                  localReadsStateRef.current.delete(item.id)
                  resolvedIds.add(item.id)
                }
              }
            } else if (item.type === 'socket') {
              if (existSet.has(item.id)) {
                resolvedIds.add(item.id)
              } else {
                item.attempts += 1
                if (item.attempts >= MAX_ID_ATTEMPTS) {
                  resolvedIds.add(item.id)
                }
              }
            }
          })

          coordinator.queue = coordinator.queue.filter((item) => !resolvedIds.has(item.id))
          setUnreadCount(authoritativeUnread)

          // If all items in this batch were unresolved across attempts, pause briefly to avoid hot spin
          const unresolvable = batch.filter((item) => !resolvedIds.has(item.id))
          if (unresolvable.length === batch.length) {
            await new Promise((r) => setTimeout(r, 100))
          }
        } catch (err) {
          coordinator.networkRetries++
          console.warn(`[NotificationContext] Follow-up reconciliation attempt ${coordinator.networkRetries} failed:`, err.message)
          if (coordinator.networkRetries >= 2) {
            break // Bounded retry stop; surviving queue items preserved
          }
          await new Promise((r) => setTimeout(r, 200))
        }
      }
    } finally {
      coordinator.isRunning = false
      if (coordinator.queue.length === 0 || gen !== refreshGenerationRef.current) {
        coordinator.isCompleted = true
        coordinatorsRef.current.delete(gen)
      }
    }
  }, [])

  // Fetch notifications and unread count from API using generation-scoped protocol
  const refreshNotifications = useCallback(async () => {
    if (!token) {
      resetNotificationState()
      return
    }

    const previousGen = refreshGenerationRef.current
    const currentGen = ++refreshGenerationRef.current
    activeRefreshGenRef.current = currentGen
    generationSocketBufferRef.current.set(currentGen, new Map())
    setLoading(true)

    // Absorb unprocessed items from preceding generation + local reads + socket buffer
    const previousQueue = coordinatorsRef.current.get(previousGen)?.queue || []
    coordinatorsRef.current.delete(previousGen)

    const bufferedMap = generationSocketBufferRef.current.get(currentGen) || new Map()
    const socketItems = Array.from(bufferedMap.values()).map((n) => ({
      id: n._id.toString(),
      type: 'socket',
      attempts: 0,
    }))
    const localReadItems = Array.from(locallyReadIdsRef.current).map((id) => ({
      id,
      type: 'local_read',
      attempts: 0,
    }))

    const mergedQueueMap = new Map()
    ;[...previousQueue, ...localReadItems, ...socketItems].forEach((item) => {
      if (!mergedQueueMap.has(item.id)) {
        mergedQueueMap.set(item.id, item)
      }
    })

    const coordinator = {
      generation: currentGen,
      queue: Array.from(mergedQueueMap.values()),
      isRunning: false,
      submittedIds: new Set(),
      isCompleted: false,
      networkRetries: 0,
    }
    coordinatorsRef.current.set(currentGen, coordinator)

    try {
      // Extract Batch 1 (up to 100 IDs)
      const batch1 = coordinator.queue.slice(0, MAX_RECONCILE_BATCH)
      const batch1Ids = batch1.map((item) => item.id)
      coordinator.submittedIds = new Set(batch1Ids)

      const res = await api.get('/notifications', {
        params: {
          limit: 25,
          reconcileIds: batch1Ids.length > 0 ? batch1Ids.join(',') : undefined,
        },
      })

      // Strict Generation Fencing
      if (currentGen !== refreshGenerationRef.current) {
        coordinator.isCompleted = true
        coordinatorsRef.current.delete(currentGen)
        generationSocketBufferRef.current.delete(currentGen)
        return
      }

      const restItems = res.data?.notifications || []
      let serverUnreadCount = Number(res.data?.unreadCount || 0)
      const existSet = new Set(res.data?.reconciledNotificationIds || [])
      const unreadSet = new Set(res.data?.reconciledUnreadIds || [])

      // Register REST notification IDs
      restItems.forEach((n) => {
        if (n?._id) seenNotificationIdsRef.current.add(n._id.toString())
      })

      // Reconcile Batch 1 items
      const resolvedIds = new Set()
      batch1.forEach((item) => {
        if (item.type === 'local_read') {
          if (existSet.has(item.id)) {
            if (unreadSet.has(item.id)) {
              // Server still unread: adjust server count
              serverUnreadCount = Math.max(0, serverUnreadCount - 1)
            } else {
              // Confirmed read on server
              locallyReadIdsRef.current.delete(item.id)
              localReadsStateRef.current.delete(item.id)
            }
            resolvedIds.add(item.id)
          } else {
            item.attempts += 1
            if (item.attempts >= MAX_ID_ATTEMPTS) {
              locallyReadIdsRef.current.delete(item.id)
              localReadsStateRef.current.delete(item.id)
              resolvedIds.add(item.id)
            }
          }
        } else if (item.type === 'socket') {
          if (existSet.has(item.id)) {
            resolvedIds.add(item.id)
          } else {
            item.attempts += 1
            if (item.attempts >= MAX_ID_ATTEMPTS) {
              resolvedIds.add(item.id)
            }
          }
        }
      })

      coordinator.queue = coordinator.queue.filter((item) => !resolvedIds.has(item.id))

      // Ingest any socket notifications received during the primary HTTP roundtrip
      const liveBuffer = generationSocketBufferRef.current.get(currentGen) || new Map()
      Array.from(liveBuffer.values()).forEach((n) => {
        const idStr = n._id.toString()
        if (!coordinator.submittedIds.has(idStr) && !mergedQueueMap.has(idStr)) {
          coordinator.queue.push({ id: idStr, type: 'socket', attempts: 0 })
        }
      })

      // Reconcile restItems with local optimistic reads
      const reconciledRestItems = restItems.map((item) => {
        const idStr = item._id.toString()
        if (locallyReadIdsRef.current.has(idStr)) {
          return { ...item, isRead: true }
        }
        return item
      })

      // Pure state update
      setUnreadCount(serverUnreadCount)
      setNotifications((prev) => {
        const olderItems = prev.filter((n) => !restItems.some((r) => r._id.toString() === n._id.toString()))
        const combinedMap = new Map()
        ;[...olderItems, ...reconciledRestItems].forEach((n) => {
          if (n?._id) combinedMap.set(n._id.toString(), n)
        })
        return Array.from(combinedMap.values()).sort(
          (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
        )
      })

      setLoading(false)

      // Launch generation coordinator if queue has remaining items
      if (coordinator.queue.length > 0) {
        runGenerationCoordinator(currentGen)
      } else {
        coordinator.isCompleted = true
        coordinatorsRef.current.delete(currentGen)
      }
    } catch (err) {
      if (coordinator) {
        coordinator.isRunning = false
        coordinator.isCompleted = true
      }
      generationSocketBufferRef.current.delete(currentGen)
      if (currentGen === refreshGenerationRef.current) {
        console.warn('Primary refresh error:', err.message)
        setLoading(false)
      }
    }
  }, [token, resetNotificationState, runGenerationCoordinator])

  // Establish persistent, authenticated Socket.io connection
  useEffect(() => {
    if (!token) {
      resetNotificationState()
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
      socket.emit('authenticate', token)
    })

    // Continuous real-time notification listener
    socket.on('notification:new', (notif) => {
      if (!notif || !notif._id) return
      const notifId = notif._id.toString()

      // Deduplicate against duplicate socket packets or already seen items
      if (seenNotificationIdsRef.current.has(notifId)) {
        return
      }
      seenNotificationIdsRef.current.add(notifId)

      // Continuous queue ingestion into active generation coordinator
      if (activeRefreshGenRef.current !== null) {
        const activeCoord = coordinatorsRef.current.get(activeRefreshGenRef.current)
        if (activeCoord && !activeCoord.isCompleted) {
          const inQueue = activeCoord.queue.some((item) => item.id === notifId)
          if (!inQueue) {
            activeCoord.queue.push({ id: notifId, type: 'socket', attempts: 0 })
          }
        }
        const genBuffer = generationSocketBufferRef.current.get(activeRefreshGenRef.current)
        if (genBuffer) {
          genBuffer.set(notifId, notif)
        }
      }

      // Pure UI updates outside state updater
      if (!notif.isRead) {
        unreadIdsRef.current.add(notifId)
        setUnreadCount((c) => c + 1)
      }
      addToast(`${notif.title}: ${notif.message}`, 'info')

      setNotifications((prev) => [notif, ...prev])
    })

    socket.on('disconnect', (reason) => {
      console.log('[Socket.io] Notification socket disconnected:', reason)
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [token, addToast, refreshNotifications, resetNotificationState])

  // Mark single notification as read with synchronous ref lock and pure state updater
  const markAsRead = async (id) => {
    if (!id) return
    const idStr = id.toString()

    // 1. Synchronous guards against duplicate in-flight requests and already-read notifications
    if (inFlightReadIdsRef.current.has(idStr)) {
      return
    }
    if (!unreadIdsRef.current.has(idStr)) {
      return
    }

    // 2. Synchronous lock & unread-ref deletion (before async boundary)
    inFlightReadIdsRef.current.add(idStr)
    unreadIdsRef.current.delete(idStr)
    locallyReadIdsRef.current.add(idStr)
    localReadsStateRef.current.set(idStr, { status: 'pending' })

    // 3. Exact-once optimistic update
    setUnreadCount((c) => Math.max(0, c - 1))
    setNotifications((prev) =>
      prev.map((n) => (n._id?.toString() === idStr ? { ...n, isRead: true } : n))
    )

    try {
      await api.put(`/notifications/${id}/read`)
      // Confirmed server success
      inFlightReadIdsRef.current.delete(idStr)
      localReadsStateRef.current.set(idStr, { status: 'confirmed' })
    } catch (err) {
      inFlightReadIdsRef.current.delete(idStr)

      const isConfirmedClientError =
        err.response && err.response.status >= 400 && err.response.status < 500

      if (isConfirmedClientError) {
        // Confirmed server rejection (e.g. 404, 403)
        locallyReadIdsRef.current.delete(idStr)
        localReadsStateRef.current.set(idStr, { status: 'failed' })
        unreadIdsRef.current.add(idStr)

        setUnreadCount((c) => c + 1)
        setNotifications((prev) =>
          prev.map((n) => (n._id?.toString() === idStr ? { ...n, isRead: false } : n))
        )
      } else {
        // Ambiguous failure (network timeout, connection reset, 500)
        // Keep optimistic read marker in locallyReadIdsRef and schedule refresh
        console.warn(`Ambiguous failure for notification ${idStr}; preserving optimistic read:`, err.message)
        refreshNotifications()
      }
    }
  }

  // Mark all notifications as read
  const markAllAsRead = async () => {
    try {
      await api.put('/notifications/read-all')
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })))
      setUnreadCount(0)
      unreadIdsRef.current.clear()
      locallyReadIdsRef.current.clear()
      localReadsStateRef.current.clear()
      addToast('All notifications marked as read', 'info')
    } catch (err) {
      console.error('Failed to mark all as read:', err)
    }
  }

  // Delete individual notification
  const deleteNotification = async (id) => {
    try {
      const target = notifications.find((n) => n._id === id)
      await api.delete(`/notifications/${id}`)
      setNotifications((prev) => prev.filter((n) => n._id !== id))
      if (target && !target.isRead) {
        setUnreadCount((prev) => Math.max(0, prev - 1))
        unreadIdsRef.current.delete(id.toString())
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
      unreadIdsRef.current.clear()
      locallyReadIdsRef.current.clear()
      localReadsStateRef.current.clear()
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
