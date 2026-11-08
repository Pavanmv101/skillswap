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
        // Use rAF to defer scroll to the next paint frame, avoiding INP penalties
        requestAnimationFrame(() => {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' })
          // Update URL hash after scroll initiates, in a separate microtask
          requestAnimationFrame(() => {
            window.history.replaceState(null, '', `/#${sectionId}`)
          })
        })
      }
    } else {
      navigate(`/#${sectionId}`)
    }
  }

  return (
    <header className="marketing-navbar-wrapper">
      <nav className="marketing-navbar-floating" aria-label="Main Navigation">
        {/* Brand */}
        <Link to="/" className="marketing-brand" onClick={() => setMobileMenuOpen(false)}>
          <div className="brand-icon-halo">
            <IconLogo size={24} />
          </div>
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
            className="navbar-icon-pill"
            onClick={toggleTheme}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            title={isDark ? 'Light mode' : 'Dark mode'}
          >
            {isDark ? <IconSun size={17} /> : <IconMoon size={17} />}
          </button>

          {token ? (
            <Link to="/dashboard" className="btn-cinematic-primary btn-nav-cta">
              Workspace <IconArrowRight size={14} />
            </Link>
          ) : (
            <>
              <Link to="/login" className="nav-text-btn">
                Sign In
              </Link>
              <Link to="/register" className="btn-cinematic-primary btn-nav-cta">
                Start Learning <IconArrowRight size={14} />
              </Link>
            </>
          )}

          {/* Mobile Menu Toggle */}
          <button
            type="button"
            className="navbar-mobile-toggle mobile-only"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle navigation menu"
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <IconX size={20} /> : <IconMenu size={20} />}
          </button>
        </div>

        {/* Mobile Floating Drawer */}
        {mobileMenuOpen && (
          <div className="marketing-mobile-drawer animate-pop-in">
            <div className="drawer-links-group">
              <a href="/#how-it-works" className="marketing-drawer-link" onClick={(e) => handleNavClick(e, 'how-it-works')}>How it Works</a>
              <a href="/#features" className="marketing-drawer-link" onClick={(e) => handleNavClick(e, 'features')}>Features</a>
              <a href="/#trust" className="marketing-drawer-link" onClick={(e) => handleNavClick(e, 'trust')}>Trust & Verification</a>
              <a href="/#community" className="marketing-drawer-link" onClick={(e) => handleNavClick(e, 'community')}>Community</a>
            </div>
            <div className="marketing-drawer-actions">
              {token ? (
                <Link to="/dashboard" className="btn-cinematic-primary btn-block text-center" onClick={() => setMobileMenuOpen(false)}>
                  Workspace <IconArrowRight size={14} />
                </Link>
              ) : (
                <>
                  <Link to="/login" className="btn-cinematic-secondary btn-block text-center" onClick={() => setMobileMenuOpen(false)}>
                    Sign In
                  </Link>
                  <Link to="/register" className="btn-cinematic-primary btn-block text-center" onClick={() => setMobileMenuOpen(false)}>
                    Start Learning Free <IconArrowRight size={14} />
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </nav>
    </header>
  )
}
