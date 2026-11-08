import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  IconSearch,
  IconRepeat,
  IconVideo,
  IconShield,
  IconLearning,
  IconCalendar,
  IconArrowRight,
  IconCheckCircle,
  IconAward,
  IconUsers,
  IconSparkles,
  IconLogo
} from '../components/Icons'

const CORE_STEPS = [
  {
    step: '01',
    title: 'Profile & Skills',
    desc: 'List the disciplines you have mastered and the skills you aspire to acquire. No credit card or currency required.',
    icon: IconSparkles
  },
  {
    step: '02',
    title: 'Mutual Match Engine',
    desc: 'Our barter algorithm surfaces peers whose learning goals complement your teaching offerings with compatibility scores.',
    icon: IconSearch
  },
  {
    step: '03',
    title: 'Slot Synchronization',
    desc: 'Select mutually available time windows across timezones without tedious scheduling back-and-forth.',
    icon: IconCalendar
  },
  {
    step: '04',
    title: 'Live P2P Session',
    desc: 'Meet directly in built-in WebRTC video rooms with screen sharing, device selection, and zero required downloads.',
    icon: IconVideo
  },
  {
    step: '05',
    title: 'Reputation & Growth',
    desc: 'Verify completed exchanges, record mutual reliability, and earn skill badges backed by real peer reviews.',
    icon: IconAward
  }
]

const CAPABILITIES = [
  {
    icon: IconSearch,
    title: 'Smart Barter Matching',
    desc: 'Dynamic scoring computes skill overlap, mutual requirements, and timezone synchronicity to suggest optimal exchange partners.'
  },
  {
    icon: IconRepeat,
    title: '3-Way Circular Cycles',
    desc: 'When direct 2-way swaps hit deadlocks, our engine discovers closed 3-person barter loops where everyone teaches and learns.'
  },
  {
    icon: IconVideo,
    title: 'Native WebRTC Video Rooms',
    desc: 'Direct browser-to-browser peer calling with low latency, screen sharing, device selection, and zero required downloads.'
  },
  {
    icon: IconShield,
    title: 'Peer Trust & Verification',
    desc: 'Community ratings, attendance reliability tracking, and institutional credential reviews guarantee focused, safe exchanges.'
  },
  {
    icon: IconLearning,
    title: 'Curated Learning Roadmaps',
    desc: 'Structured curricula across software engineering, data science, creative design, languages, and technical disciplines.'
  },
  {
    icon: IconCalendar,
    title: 'Mutual Slot Detection',
    desc: 'Instant visualization of overlapping hours across different timezones, synchronizing both participants with one click.'
  }
]

export default function Landing() {
  const { token } = useAuth()
  const location = useLocation()

  useEffect(() => {
    if (location.hash) {
      const id = location.hash.replace('#', '')
      const el = document.getElementById(id)
      if (el) {
        setTimeout(() => el.scrollIntoView({ behavior: 'smooth' }), 60)
      }
    }
  }, [location.hash])

  function scrollToSection(e, id) {
    e.preventDefault()
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' })
    }
  }

  return (
    <div className="landing-wrapper">
      {/* ─── Hero Section ────────────────────────────────────────────────────── */}
      <section className="hero-section">
        <div className="hero-ambient-halo" />
        <div className="hero-container">
          <div className="hero-pill-badge">
            <span className="hero-pulse-dot" />
            <span>Peer-to-Peer Knowledge Barter</span>
          </div>

          <h1 className="hero-main-title">
            Trade what you know.<br />
            <span className="hero-gradient-text">Master what you don't.</span>
          </h1>

          <p className="hero-description">
            Exchange skills, share knowledge, and grow together — without exchanging money.
          </p>

          <div className="hero-cta-group">
            {token ? (
              <Link to="/dashboard" className="btn-cinematic-primary">
                Open Workspace <IconArrowRight size={16} />
              </Link>
            ) : (
              <>
                <Link to="/register" className="btn-cinematic-primary">
                  Start Learning <IconArrowRight size={16} />
                </Link>
                <a
                  href="#features"
                  onClick={(e) => scrollToSection(e, 'features')}
                  className="btn-cinematic-secondary"
                >
                  Explore Skills
                </a>
              </>
            )}
          </div>

          {/* ─── Live Barter Mockup Composition ───────────────────────────────── */}
          <div className="hero-mockup-wrapper">
            <div className="hero-showcase-glow" />
            <div className="hero-mockup-card">
              <div className="mockup-card-top">
                <div className="mockup-profile">
                  <div className="mockup-avatar avatar-indigo">AS</div>
                  <div>
                    <div className="mockup-name">Aarav Sharma</div>
                    <div className="mockup-sub">Full Stack Engineer • 100% Reliability</div>
                  </div>
                </div>

                <div className="mockup-score-badge">
                  <span className="score-number">98%</span>
                  <span className="score-label">MATCH SCORE</span>
                </div>

                <div className="mockup-profile mockup-profile-right">
                  <div>
                    <div className="mockup-name">Priya Patel</div>
                    <div className="mockup-sub">Data Scientist • 5.0 ★ Rating</div>
                  </div>
                  <div className="mockup-avatar avatar-emerald">PP</div>
                </div>
              </div>

              {/* Bilateral Exchange Visual Flow */}
              <div className="mockup-flow-grid">
                <div className="mockup-flow-leg">
                  <span className="leg-label">Aarav Teaches</span>
                  <div className="leg-skill-tag">
                    <span className="dot dot-indigo" />
                    <span>React & Next.js Architecture</span>
                  </div>
                </div>

                <div className="mockup-flow-icon">
                  <IconRepeat size={24} />
                </div>

                <div className="mockup-flow-leg" style={{ textAlign: 'right' }}>
                  <span className="leg-label">Priya Teaches</span>
                  <div className="leg-skill-tag" style={{ justifyContent: 'flex-end' }}>
                    <span>Python & Machine Learning</span>
                    <span className="dot dot-emerald" />
                  </div>
                </div>
              </div>

              {/* Session Status Footer */}
              <div className="mockup-card-bottom">
                <div className="mockup-detail-item">
                  <IconCalendar size={15} />
                  <span>Next Swap: <strong>Tomorrow at 3:00 PM (IST)</strong></span>
                </div>
                <div className="mockup-detail-item">
                  <span className="status-indicator-dot" />
                  <span className="status-live">WebRTC P2P Video Active</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── How It Works (5 Core Stages) ────────────────────────────────────── */}
      <section id="how-it-works" className="landing-section">
        <div className="section-container">
          <div className="section-header-block">
            <span className="section-pill">HOW IT WORKS</span>
            <h2 className="section-heading">Frictionless peer learning in five stages</h2>
            <p className="section-subheading">
              Built specifically for autonomous learners and student peers who want structured, reliable collaboration.
            </p>
          </div>

          <div className="steps-flow-container">
            {CORE_STEPS.map((s) => {
              const Icon = s.icon
              return (
                <div className="step-flow-card" key={s.step}>
                  <div className="step-card-header">
                    <div className="step-icon-bubble">
                      <Icon size={20} />
                    </div>
                    <span className="step-sequence-num">{s.step}</span>
                  </div>
                  <h3 className="step-card-title">{s.title}</h3>
                  <p className="step-card-desc">{s.desc}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ─── Advanced Exchange Architecture (Bilateral vs Circular) ─────────── */}
      <section id="architecture" className="landing-section section-contrast">
        <div className="section-container">
          <div className="section-header-block">
            <span className="section-pill">EXCHANGE ARCHITECTURE</span>
            <h2 className="section-heading">Direct 1:1 and 3-way circular exchanges</h2>
            <p className="section-subheading">
              SkillSwap eliminates deadlocks. If a peer wants your skill but you need something they don't teach, our circular solver connects a third peer to complete the cycle.
            </p>
          </div>

          <div className="exchange-comparison-grid">
            {/* Bilateral Card */}
            <div className="exchange-type-card">
              <div className="exchange-card-badge">DIRECT PAIRING</div>
              <h3 className="exchange-title">Bilateral 1:1 Swap</h3>
              <p className="exchange-desc">
                Ideal when two peers have complementary skill sets and matching availability.
              </p>

              <div className="exchange-visual-box">
                <div className="node-item">
                  <div className="node-avatar">A</div>
                  <div className="node-meta">
                    <strong>Peer A</strong>
                    <span>Teaches React</span>
                  </div>
                </div>
                <div className="exchange-arrows-bidirectional">
                  <span>⇄</span>
                  <small>Mutual barter</small>
                </div>
                <div className="node-item">
                  <div className="node-avatar">B</div>
                  <div className="node-meta">
                    <strong>Peer B</strong>
                    <span>Teaches Python</span>
                  </div>
                </div>
              </div>

              <ul className="exchange-features-list">
                <li><IconCheckCircle size={16} /> Direct time-slot synchronization</li>
                <li><IconCheckCircle size={16} /> Instant mutual confirmation</li>
                <li><IconCheckCircle size={16} /> Private 1:1 WebRTC video room</li>
              </ul>
            </div>

            {/* Circular Cycle Card */}
            <div className="exchange-type-card exchange-card-highlight">
              <div className="exchange-card-badge badge-brand">INNOVATION</div>
              <h3 className="exchange-title">Three-Way Circular Cycle</h3>
              <p className="exchange-desc">
                Discovers closed three-person barter loops so no learner is left waiting for a direct match.
              </p>

              <div className="circular-visual-box">
                <div className="circular-node-row">
                  <div className="circle-node">
                    <span className="circle-avatar">A</span>
                    <small>Teaches React</small>
                  </div>
                  <div className="circle-vector">➔</div>
                  <div className="circle-node">
                    <span className="circle-avatar">B</span>
                    <small>Teaches UI/UX</small>
                  </div>
                </div>
                <div className="circular-return-row">
                  <div className="circle-vector-up">↑</div>
                  <div className="circle-vector-down">↓</div>
                </div>
                <div className="circular-node-center">
                  <div className="circle-node">
                    <span className="circle-avatar">C</span>
                    <small>Teaches French</small>
                  </div>
                </div>
              </div>

              <ul className="exchange-features-list">
                <li><IconCheckCircle size={16} /> Multi-party proposal management</li>
                <li><IconCheckCircle size={16} /> Atomic slot reservation engine</li>
                <li><IconCheckCircle size={16} /> Synchronized mutual completions</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Platform Capabilities Grid ──────────────────────────────────────── */}
      <section id="features" className="landing-section">
        <div className="section-container">
          <div className="section-header-block">
            <span className="section-pill">SYSTEM CAPABILITIES</span>
            <h2 className="section-heading">Engineered for serious peer collaboration</h2>
            <p className="section-subheading">
              Every feature is built around accountability, transparency, and high-impact learning.
            </p>
          </div>

          <div className="capabilities-grid">
            {CAPABILITIES.map((cap) => {
              const Icon = cap.icon
              return (
                <div className="capability-card" key={cap.title}>
                  <div className="capability-icon-wrap">
                    <Icon size={22} />
                  </div>
                  <h4 className="capability-title">{cap.title}</h4>
                  <p className="capability-desc">{cap.desc}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ─── Trust & Verification Section ───────────────────────────────────── */}
      <section id="trust" className="landing-section section-contrast">
        <div className="section-container">
          <div className="trust-banner-card">
            <div className="trust-card-content">
              <span className="section-pill">ACCOUNTABILITY</span>
              <h2 className="trust-heading">Verified credibility and peer endorsements</h2>
              <p className="trust-body">
                SkillSwap maintains high standards through transparent reputation. Submit certificate proofs or portfolio links to earn official verification badges, receive post-session peer endorsements, and maintain reliable exchange metrics.
              </p>
              <div className="trust-points-grid">
                <div className="trust-point">
                  <IconShield size={18} />
                  <span>Admin-audited skill verification</span>
                </div>
                <div className="trust-point">
                  <IconAward size={18} />
                  <span>Peer post-swap endorsements</span>
                </div>
                <div className="trust-point">
                  <IconUsers size={18} />
                  <span>Public reputation metrics</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Bottom CTA Banner ──────────────────────────────────────────────── */}
      <section id="community" className="landing-cta-banner">
        <div className="section-container cta-container">
          <div className="cta-content-box">
            <h2 className="cta-main-title">Ready to exchange knowledge with peers?</h2>
            <p className="cta-sub-title">
              Set up your profile in minutes, list skills you can teach, and discover partners ready to barter learning.
            </p>
            <div className="cta-btn-row">
              <Link to={token ? "/dashboard" : "/register"} className="btn-cinematic-primary">
                Start Learning Free <IconArrowRight size={16} />
              </Link>
              {!token && (
                <Link to="/login" className="btn-cinematic-secondary">
                  Sign In with Demo
                </Link>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ─── Professional SaaS Footer ────────────────────────────────────────── */}
      <footer className="landing-footer">
        <div className="section-container footer-container">
          <div className="footer-top-row">
            <div className="footer-brand-col">
              <Link to="/" className="footer-brand">
                <IconLogo size={26} />
                <span className="brand-name">SkillSwap</span>
              </Link>
              <p className="footer-tagline">
                Peer-to-peer knowledge barter platform. Exchange skills without monetary transactions.
              </p>
            </div>

            <div className="footer-links-col">
              <span className="footer-links-title">PLATFORM</span>
              <Link to="/matches" className="footer-link">Discover Peers</Link>
              <Link to="/recommendations" className="footer-link">Recommendation Engine</Link>
              <Link to="/swaps" className="footer-link">Exchange Management</Link>
              <Link to="/learning" className="footer-link">Learning Roadmaps</Link>
            </div>

            <div className="footer-links-col">
              <span className="footer-links-title">EXCHANGE MODES</span>
              <span className="footer-text-link">Bilateral 1:1 Barter</span>
              <span className="footer-text-link">3-Way Circular Cycles</span>
              <span className="footer-text-link">Native WebRTC Video</span>
              <span className="footer-text-link">Mutual Slot Matching</span>
            </div>

            <div className="footer-links-col">
              <span className="footer-links-title">TRUST & SAFETY</span>
              <span className="footer-text-link">Admin Skill Verifications</span>
              <span className="footer-text-link">Peer Endorsements</span>
              <span className="footer-text-link">Reputation & Reviews</span>
              <span className="footer-text-link">Strict Zero-Monetary Policy</span>
            </div>
          </div>

          <div className="footer-bottom-row">
            <div className="footer-copyright">
              © {new Date().getFullYear()} SkillSwap Network. All rights reserved. Built with modern React & Node.js.
            </div>
            <div className="footer-legal">
              <span className="footer-badge-pill">Production SaaS Edition</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
