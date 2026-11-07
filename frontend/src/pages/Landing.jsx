import React from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  IconLogo,
  IconArrowRight,
  IconDiscover,
  IconSwaps,
  IconCalendar,
  IconLearning,
  IconShield,
  IconRepeat,
  IconBookOpen,
  IconAward,
  IconUsers,
  IconCheckCircle,
  IconVideo
} from '../components/Icons'

const CORE_STEPS = [
  {
    step: '01',
    icon: IconDiscover,
    title: 'Discover Complementary Peers',
    desc: 'Our bidirectional scoring algorithm analyzes your taught and wanted skills, finding peers who need what you know and teach what you seek.'
  },
  {
    step: '02',
    icon: IconRepeat,
    title: 'Exchange Knowledge Without Money',
    desc: 'Pure peer-to-peer barter. Every hour you spend teaching earns you an hour of focused learning. No transaction fees, credits, or subscriptions.'
  },
  {
    step: '03',
    icon: IconCalendar,
    title: 'Coordinate Overlapping Schedules',
    desc: 'Compare weekly recurring availability windows to pinpoint mutual free times automatically, preventing tedious back-and-forth scheduling.'
  },
  {
    step: '04',
    icon: IconBookOpen,
    title: 'Track Structured Roadmaps',
    desc: 'Follow curated learning tracks with milestone checklists, resource recommendations, and interactive assessment quizzes to measure real progress.'
  },
  {
    step: '05',
    icon: IconAward,
    title: 'Build Verifiable Credibility',
    desc: 'Earn post-swap endorsements, showcase project proofs, and obtain administrator-reviewed skill credentials that peers can trust.'
  }
]

const CAPABILITIES = [
  {
    icon: IconSwaps,
    title: 'Bidirectional Matching',
    desc: 'Calculates reciprocal affinity up to 100 points, prioritizing exact skill overlaps and balanced learning levels.'
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

  return (
    <div className="landing-wrapper">
      {/* ─── Hero Section ────────────────────────────────────────────────────── */}
      <section className="hero-section">
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
            SkillSwap is a pure peer-to-peer knowledge exchange. Connect with peers to trade coding lessons for design mentorship, language practice for data analysis, and technical skills — without monetary transactions.
          </p>

          <div className="hero-cta-group">
            {token ? (
              <Link to="/dashboard" className="btn btn-primary btn-lg shadow-glow">
                Go to Workspace <IconArrowRight size={18} />
              </Link>
            ) : (
              <>
                <Link to="/register" className="btn btn-primary btn-lg shadow-glow">
                  Start Learning Free <IconArrowRight size={18} />
                </Link>
                <a href="#how-it-works" className="btn btn-secondary btn-lg">
                  Explore How It Works
                </a>
              </>
            )}
          </div>

          {/* ─── Live Barter Mockup Composition ───────────────────────────────── */}
          <div className="hero-mockup-wrapper">
            <div className="hero-mockup-card">
              <div className="mockup-card-top">
                <div className="mockup-profile">
                  <div className="mockup-avatar avatar-indigo">AS</div>
                  <div>
                    <div className="mockup-name">Aarav Sharma</div>
                    <div className="mockup-sub">Computer Science</div>
                  </div>
                </div>

                <div className="mockup-score-badge">
                  <span className="score-number">98</span>
                  <span className="score-label">MATCH SCORE</span>
                </div>

                <div className="mockup-profile mockup-profile-right">
                  <div>
                    <div className="mockup-name">Priya Patel</div>
                    <div className="mockup-sub">Data & Analytics</div>
                  </div>
                  <div className="mockup-avatar avatar-emerald">PP</div>
                </div>
              </div>

              {/* Barter Flow Exchange Bar */}
              <div className="mockup-flow-grid">
                <div className="mockup-flow-leg">
                  <span className="leg-label">Aarav teaches</span>
                  <div className="leg-skill-tag teach-tag">
                    <span className="dot dot-indigo" /> React & TypeScript
                  </div>
                </div>

                <div className="mockup-flow-icon" title="Bidirectional exchange">
                  <IconSwaps size={22} />
                </div>

                <div className="mockup-flow-leg">
                  <span className="leg-label">Priya teaches</span>
                  <div className="leg-skill-tag learn-tag">
                    <span className="dot dot-emerald" /> Python & Machine Learning
                  </div>
                </div>
              </div>

              <div className="mockup-card-bottom">
                <div className="mockup-detail-item">
                  <IconCalendar size={15} />
                  <span>Mutual Slot: <strong>Monday 18:00 – 19:30 UTC</strong></span>
                </div>
                <div className="mockup-detail-item status-live">
                  <span className="status-indicator-dot" />
                  <span>WebRTC P2P Video Active</span>
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
            {CORE_STEPS.map((s, idx) => {
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
      <section className="landing-section section-contrast">
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
      <section className="landing-section">
        <div className="section-container">
          <div className="section-header-block">
            <span className="section-pill">SYSTEM CAPABILITIES</span>
            <h2 className="section-heading">Engineered for serious peer collaboration</h2>
            <p className="section-subheading">
              Every feature is built around accountability, transparency, and high-impact learning.
            </p>
          </div>

          <div className="capabilities-grid">
            {CAPABILITIES.map((cap, i) => {
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
      <section className="landing-section section-contrast">
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
      <section className="landing-cta-banner">
        <div className="section-container cta-container">
          <div className="cta-content-box">
            <h2 className="cta-main-title">Ready to exchange knowledge with peers?</h2>
            <p className="cta-sub-title">
              Set up your profile in minutes, list skills you can teach, and discover partners ready to barter learning.
            </p>
            <div className="cta-btn-row">
              <Link to={token ? "/dashboard" : "/register"} className="btn btn-primary btn-lg shadow-glow">
                Get Started Free <IconArrowRight size={18} />
              </Link>
              {!token && (
                <Link to="/login" className="btn btn-secondary btn-lg">
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
