import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { ToastProvider } from './context/ToastContext'
import Navbar    from './components/Navbar'
import Landing   from './pages/Landing'
import Login     from './pages/Login'
import Register  from './pages/Register'
import Dashboard from './pages/Dashboard'
import Profile   from './pages/Profile'
import Matches   from './pages/Matches'
import Swaps     from './pages/Swaps'
import Room      from './pages/Room'
import PublicProfile from './pages/PublicProfile'

function PrivateRoute({ children }) {
  const { token } = useAuth()
  return token ? children : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <div className="app-shell">
          <Navbar />
          <main className="main-content">
            <Routes>
              <Route path="/"         element={<Landing />} />
              <Route path="/login"    element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/dashboard"      element={<PrivateRoute><Dashboard /></PrivateRoute>} />
              <Route path="/profile"        element={<PrivateRoute><Profile /></PrivateRoute>} />
              <Route path="/matches"        element={<PrivateRoute><Matches /></PrivateRoute>} />
              <Route path="/swaps"          element={<PrivateRoute><Swaps /></PrivateRoute>} />
              <Route path="/room/:roomId"   element={<PrivateRoute><Room /></PrivateRoute>} />
              <Route path="/user/:id"       element={<PrivateRoute><PublicProfile /></PrivateRoute>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </ToastProvider>
  )
}
