import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const HOW_IT_WORKS = [
  {
    step: '01',
    title: 'List Your Skills',
    desc: 'Share what you excel at (coding, music, design) and choose what you are eager to learn.',
    icon: '🎯'
  },
  {
    step: '02',
    title: 'Instant Smart Match',
    desc: 'Our bidirectional scoring algorithm pairs you with peers based on reciprocal interests and schedules.',
    icon: '⚡'
  },
  {
    step: '03',
    title: 'Barter & Learn Live',
    desc: 'Connect in an integrated Jitsi video session. No fees, no subscriptions, just pure peer-to-peer knowledge.',
    icon: '🚀'
  }
]

const STATS = [
  { num: '100%', label: 'Free Peer Exchange' },
  { num: '0.0s', label: 'Setup for Video Rooms' },
  { num: '100 pts', label: 'Transparent Match Engine' },
  { num: '4.9★', label: 'Average Peer Rating' },
]

export default function Landing() {
  const { token } = useAuth()

  return (
    <div className="landing-wrapper">
      {/* Hero Section */}
      <section className="hero">
        <div className="hero-content">
          <div className="hero-badge">
            <span className="pulse-dot"></span>
            Peer-to-Peer Skill Barter System
          </div>
          <h1 className="hero-title">
            Trade What You Know.<br />
            <span className="gradient-text">Master What You Don't.</span>
          </h1>
          <p className="hero-sub">
            The currency on SkillSwap is knowledge. Swap coding lessons for guitar sessions, UI design for Python data science, or language practice for academic prep.
          </p>

          <div className="hero-actions">
            {token ? (
              <Link to="/dashboard" className="btn btn-primary btn-lg shadow-glow">
                Go to Dashboard →
              </Link>
            ) : (
              <>
                <Link to="/register" className="btn btn-primary btn-lg shadow-glow">
                  Get Started Free
                </Link>
                <Link to="/login" className="btn btn-glass btn-lg">
                  Sign In
                </Link>
              </>
            )}
          </div>

          {/* Live Mockup Barter Card */}
          <div className="hero-preview-card">
            <div className="preview-header">
              <div className="preview-user">
                <div className="preview-avatar" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>AS</div>
                <div>
                  <strong>Aarav</strong>
                  <div className="preview-sub">Teaches React & Node.js</div>
                </div>
              </div>
              <div className="preview-swap-badge">
                <span className="badge-glow">⚡ 100% Match</span>
              </div>
              <div className="preview-user" style={{ textAlign: 'right' }}>
                <div>
                  <strong>Priya</strong>
                  <div className="preview-sub">Teaches Python & ML</div>
                </div>
                <div className="preview-avatar" style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}>PP</div>
              </div>
            </div>

            <div className="preview-barter-flow">
              <div className="flow-item flow-offered">
                <span>Offered:</span> <strong>React</strong>
              </div>
              <div className="flow-arrow">⇄</div>
              <div className="flow-item flow-wanted">
                <span>Received:</span> <strong>Python</strong>
              </div>
            </div>
            <div className="preview-footer">
              <span>📅 Monday 18:00 – 20:00 (Schedule Overlap)</span>
              <span className="preview-status">🎥 Live Room Ready</span>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Counter Strip */}
      <section className="stats-strip">
        <div className="stats-strip-inner">
          {STATS.map(s => (
            <div className="strip-item" key={s.label}>
              <div className="strip-num">{s.num}</div>
              <div className="strip-label">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="section-padding">
        <div className="section-header">
          <div className="section-tag">Simple & Effective</div>
          <h2 className="section-title">How SkillSwap Works</h2>
          <p className="section-desc">Experience frictionless skill exchange in three intuitive stages.</p>
        </div>

        <div className="how-it-works-grid">
          {HOW_IT_WORKS.map(step => (
            <div className="step-card" key={step.step}>
              <div className="step-top">
                <span className="step-icon">{step.icon}</span>
                <span className="step-num">{step.step}</span>
              </div>
              <h3 className="step-title">{step.title}</h3>
              <p className="step-desc">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="cta-banner">
        <div className="cta-inner">
          <h2>Ready to Level Up Your Skills?</h2>
          <p>Join fellow students exchanging skills right now. Free forever.</p>
          <div style={{ marginTop: '1.5rem' }}>
            <Link to={token ? "/matches" : "/register"} className="btn btn-primary btn-lg shadow-glow">
              Explore Matches Now →
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
