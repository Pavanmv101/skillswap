import { NavLink, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Navbar() {
  const { token, user, logout } = useAuth()
  const navigate = useNavigate()
  function handleLogout() { logout(); navigate('/') }

  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <Link to={token ? '/dashboard' : '/'} className="navbar-brand">⚡ SkillSwap</Link>
        {token ? (
          <>
            <div className="navbar-links">
              <NavLink to="/dashboard">Dashboard</NavLink>
              <NavLink to="/matches">Matches</NavLink>
              <NavLink to="/swaps">Swaps</NavLink>
              <NavLink to="/profile">Profile</NavLink>
            </div>
            <div className="navbar-right">
              <span className="navbar-user">👤 {user?.name}</span>
              <button className="btn btn-ghost btn-sm" onClick={handleLogout}>Logout</button>
            </div>
          </>
        ) : (
          <div className="navbar-right">
            <Link to="/login" className="btn btn-muted btn-sm">Login</Link>
            <Link to="/register" className="btn btn-primary btn-sm">Get Started</Link>
          </div>
        )}
      </div>
    </nav>
  )
}
