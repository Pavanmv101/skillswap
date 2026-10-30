import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const HOW_IT_WORKS = [
  {
    step: '01',
    title: 'List Your Skills',
    desc: 'Share what you excel at — coding, music, design, languages — and tell us what you are eager to learn next.',
    icon: '🎯'
  },
  {
    step: '02',
    title: 'Instant Smart Match',
    desc: 'Our bidirectional scoring algorithm pairs you with peers based on reciprocal skill interests and overlapping schedules.',
    icon: '⚡'
  },
  {
    step: '03',
    title: 'Barter & Learn Live',
    desc: 'Connect via native WebRTC peer-to-peer video — zero latency, zero fees, no third-party relay. Just you and your peer.',
    icon: '🚀'
  }
]

const FEATURES = [
  { icon: '🤝', title: 'Bidirectional Matching', desc: 'Score up to 100 pts based on mutual skill overlap, so both partners always benefit equally.' },
  { icon: '📅', title: 'Schedule Overlap Detection', desc: 'We compare weekly availability slots to surface peers who are actually free when you are.' },
  { icon: '🎥', title: 'Native WebRTC Video', desc: 'Browser-to-browser P2P video using RTCPeerConnection — no plugins, no third-party SDK, no cost.' },
  { icon: '⭐', title: 'Post-Session Ratings', desc: 'Rate your peer after each swap. Reputation drives quality and trust across the network.' },
  { icon: '🔒', title: 'JWT Auth & Security', desc: 'Secure token-based authentication with bcrypt password hashing and protected API routes.' },
  { icon: '📊', title: 'Transparent Scoring', desc: 'See exactly why you matched — forward skill points, reverse bonus, and schedule boost explained clearly.' },
]

const TESTIMONIALS = [
  { name: 'Aarav S.', skill: 'React Developer', text: 'I traded React lessons for Python ML sessions with Priya. SkillSwap made the whole process seamless — from matching to video call in minutes!', score: 100 },
  { name: 'Priya P.', skill: 'Data Scientist', text: 'The compatibility score was spot-on. Found my perfect learning partner in seconds. The WebRTC video is incredibly smooth.', score: 98 },
  { name: 'Rohan M.', skill: 'UI/UX Designer', text: "As a designer learning guitar, I never thought I'd find a music teacher to swap with. SkillSwap matched me with exactly the right peer.", score: 85 },
]

const STATS = [
  { num: '100%', label: 'Free Peer Exchange' },
  { num: '< 1s', label: 'WebRTC Connect Time' },
  { num: '100 pts', label: 'Transparent Match Score' },
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
            The currency on SkillSwap is knowledge. Swap coding lessons for guitar sessions, UI design for Python data science, or language practice for academic prep — all powered by native WebRTC video.
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
              <span className="preview-status">🎥 WebRTC Room Ready</span>
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

      {/* Features Grid */}
      <section className="section-padding features-section">
        <div className="section-header">
          <div className="section-tag">Built Right</div>
          <h2 className="section-title">Everything You Need</h2>
          <p className="section-desc">A full-featured MERN stack platform engineered for real peer-to-peer skill exchange.</p>
        </div>

        <div className="features-grid">
          {FEATURES.map(f => (
            <div className="feature-card" key={f.title}>
              <div className="feature-icon">{f.icon}</div>
              <h4 className="feature-title">{f.title}</h4>
              <p className="feature-desc">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Testimonials */}
      <section className="section-padding">
        <div className="section-header">
          <div className="section-tag">Community Voices</div>
          <h2 className="section-title">What Peers Say</h2>
          <p className="section-desc">Real experiences from students who found their learning partners on SkillSwap.</p>
        </div>

        <div className="testimonials-grid">
          {TESTIMONIALS.map(t => (
            <div className="testimonial-card" key={t.name}>
              <div className="testimonial-header">
                <div className="testimonial-avatar">
                  {t.name.split(' ').map(n => n[0]).join('')}
                </div>
                <div>
                  <div className="testimonial-name">{t.name}</div>
                  <div className="testimonial-skill">{t.skill}</div>
                </div>
                <div className="testimonial-score">⚡ {t.score}%</div>
              </div>
              <p className="testimonial-text">"{t.text}"</p>
              <div className="testimonial-stars">{'⭐'.repeat(5)}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="cta-banner">
        <div className="cta-inner">
          <div className="cta-badge">🚀 Start Learning Today</div>
          <h2>Ready to Level Up Your Skills?</h2>
          <p>Join fellow students exchanging skills right now. Free forever. No credit card required.</p>
          <div style={{ marginTop: '1.75rem', display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to={token ? "/matches" : "/register"} className="btn btn-primary btn-lg shadow-glow">
              Explore Matches Now →
            </Link>
            <Link to="/login" className="btn btn-glass btn-lg">
              Demo Login
            </Link>
          </div>
        </div>
      </section>
    </div>
  )
}
