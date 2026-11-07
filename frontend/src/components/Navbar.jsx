import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { IconLogo, IconSun, IconMoon, IconArrowRight, IconMenu, IconX } from './Icons'

export default function Navbar() {
  const { token } = useAuth()
  const { isDark, toggleTheme } = useTheme()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()

  function handleNavClick(e, sectionId) {
    e.preventDefault()
    setMobileMenuOpen(false)
    if (location.pathname === '/') {
      const el = document.getElementById(sectionId)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' })
      }
    } else {
      navigate(`/#${sectionId}`)
    }
  }

  return (
    <nav className="marketing-navbar">
      <div className="marketing-navbar-inner">
        {/* Brand */}
        <Link to="/" className="marketing-brand">
          <IconLogo size={28} />
          <span className="brand-name">SkillSwap</span>
          <span className="marketing-tag">Peer Learning</span>
        </Link>

        {/* Center Links */}
        <div className="marketing-nav-links desktop-only">
          <a href="/#how-it-works" onClick={(e) => handleNavClick(e, 'how-it-works')} className="marketing-nav-link">How it Works</a>
          <a href="/#features" onClick={(e) => handleNavClick(e, 'features')} className="marketing-nav-link">Features</a>
          <a href="/#trust" onClick={(e) => handleNavClick(e, 'trust')} className="marketing-nav-link">Trust & Verification</a>
          <a href="/#community" onClick={(e) => handleNavClick(e, 'community')} className="marketing-nav-link">Community</a>
        </div>

        {/* Right CTA & Theme Toggle */}
        <div className="marketing-nav-actions">
          <button
            type="button"
            className="header-icon-btn"
            onClick={toggleTheme}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            title={isDark ? 'Light mode' : 'Dark mode'}
          >
            {isDark ? <IconSun size={18} /> : <IconMoon size={18} />}
          </button>

          {token ? (
            <Link to="/dashboard" className="btn btn-primary btn-sm shadow-glow">
              Workspace <IconArrowRight size={14} />
            </Link>
          ) : (
            <>
              <Link to="/login" className="btn btn-ghost btn-sm">
                Sign In
              </Link>
              <Link to="/register" className="btn btn-primary btn-sm shadow-glow">
                Get Started Free
              </Link>
            </>
          )}

          {/* Mobile Menu Toggle */}
          <button
            type="button"
            className="mobile-header-menu-btn mobile-only"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? <IconX size={20} /> : <IconMenu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer for Marketing Nav */}
      {mobileMenuOpen && (
        <div className="marketing-mobile-drawer">
          <a href="/#how-it-works" className="marketing-drawer-link" onClick={(e) => handleNavClick(e, 'how-it-works')}>How it Works</a>
          <a href="/#features" className="marketing-drawer-link" onClick={(e) => handleNavClick(e, 'features')}>Features</a>
          <a href="/#trust" className="marketing-drawer-link" onClick={(e) => handleNavClick(e, 'trust')}>Trust & Verification</a>
          <a href="/#community" className="marketing-drawer-link" onClick={(e) => handleNavClick(e, 'community')}>Community</a>
          <div className="marketing-drawer-actions">
            {token ? (
              <Link to="/dashboard" className="btn btn-primary btn-block" onClick={() => setMobileMenuOpen(false)}>
                Workspace →
              </Link>
            ) : (
              <>
                <Link to="/login" className="btn btn-muted btn-block" onClick={() => setMobileMenuOpen(false)}>
                  Sign In
                </Link>
                <Link to="/register" className="btn btn-primary btn-block" onClick={() => setMobileMenuOpen(false)}>
                  Get Started Free →
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </nav>
  )
}
