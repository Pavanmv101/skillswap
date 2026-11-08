import { useState, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { ToastProvider } from './context/ToastContext'
import { NotificationProvider } from './context/NotificationContext'
import { ThemeProvider } from './context/ThemeContext'
import Navbar        from './components/Navbar'
import Sidebar       from './components/Sidebar'
import MobileHeader  from './components/MobileHeader'
import Spinner       from './components/Spinner'

// Core path pages (eagerly loaded to ensure zero initial layout flash)
import Landing       from './pages/Landing'
import Login         from './pages/Login'
import Register      from './pages/Register'
import Dashboard     from './pages/Dashboard'

// Route-based code-splitting for specialized & secondary workspace pages
const Room               = lazy(() => import('./pages/Room'))
const AdminVerifications = lazy(() => import('./pages/AdminVerifications'))
const LearningDashboard  = lazy(() => import('./pages/LearningDashboard'))
const Recommendations    = lazy(() => import('./pages/Recommendations'))
const PublicProfile      = lazy(() => import('./pages/PublicProfile'))
const Matches            = lazy(() => import('./pages/Matches'))
const Swaps              = lazy(() => import('./pages/Swaps'))
const Profile            = lazy(() => import('./pages/Profile'))
const Notifications      = lazy(() => import('./pages/Notifications'))

function PageFallback() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '45vh' }}>
      <Spinner message="Loading workspace view…" />
    </div>
  )
}

function RoomFallback() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#0a0d14' }}>
      <Spinner message="Connecting to secure room…" />
    </div>
  )
}

function PrivateRoute({ children }) {
  const { token } = useAuth()
  return token ? children : <Navigate to="/login" replace />
}

function AdminRoute({ children }) {
  const { token, user } = useAuth()
  if (!token) return <Navigate to="/login" replace />
  if (user?.role !== 'admin') return <Navigate to="/dashboard" replace />
  return children
}

function AppLayout() {
  const { token } = useAuth()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)

  const isPublicRoute = ['/', '/login', '/register'].includes(location.pathname)
  const isRoomRoute = location.pathname.startsWith('/room/') || location.pathname.startsWith('/webrtc/')

  // Fullscreen video room layout
  if (isRoomRoute) {
    return (
      <div className="room-fullscreen-shell">
        <Suspense fallback={<RoomFallback />}>
          <Routes>
            <Route path="/room/:roomId" element={<PrivateRoute><Room /></PrivateRoute>} />
            <Route path="/webrtc/:roomId" element={<PrivateRoute><Room /></PrivateRoute>} />
          </Routes>
        </Suspense>
      </div>
    )
  }

  // Public marketing & landing layout (accessible whether authenticated or not)
  if (location.pathname === '/') {
    return (
      <div className="marketing-shell">
        <Navbar />
        <main className="marketing-content">
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    )
  }

  // Auth routes (redirect to dashboard if already logged in)
  if (['/login', '/register'].includes(location.pathname)) {
    if (token) {
      return <Navigate to="/dashboard" replace />
    }
    return (
      <div className="marketing-shell">
        <Navbar />
        <main className="marketing-content">
          <Routes>
            <Route path="/login"    element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="*"         element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    )
  }

  // Authenticated SaaS workspace layout (with responsive sidebar)
  return (
    <div className="app-shell">
      <Sidebar
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
      />
      <div className="app-main-viewport">
        <MobileHeader onOpenSidebar={() => setMobileOpen(true)} />
        <main className="app-main-content">
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/"               element={<Landing />} />
              <Route path="/login"          element={<Navigate to="/dashboard" replace />} />
              <Route path="/register"       element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard"      element={<PrivateRoute><Dashboard /></PrivateRoute>} />
              <Route path="/profile"        element={<PrivateRoute><Profile /></PrivateRoute>} />
              <Route path="/profile/:id"    element={<PrivateRoute><PublicProfile /></PrivateRoute>} />
              <Route path="/matches"        element={<PrivateRoute><Matches /></PrivateRoute>} />
              <Route path="/swaps"          element={<PrivateRoute><Swaps /></PrivateRoute>} />
              <Route path="/user/:id"       element={<PrivateRoute><PublicProfile /></PrivateRoute>} />
              <Route path="/notifications"  element={<PrivateRoute><Notifications /></PrivateRoute>} />
              <Route path="/learning"       element={<PrivateRoute><LearningDashboard /></PrivateRoute>} />
              <Route path="/recommendations" element={<PrivateRoute><Recommendations /></PrivateRoute>} />
              <Route path="/admin"          element={<AdminRoute><AdminVerifications /></AdminRoute>} />
              <Route path="*"               element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <NotificationProvider>
          <BrowserRouter>
            <AppLayout />
          </BrowserRouter>
        </NotificationProvider>
      </ToastProvider>
    </ThemeProvider>
  )
}
