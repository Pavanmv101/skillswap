import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const FEATURES = [
  { icon: '🔍', title: 'Smart Matching', desc: 'Find peers whose skills complement yours — scored by bidirectional overlap.' },
  { icon: '🔄', title: 'Skill Barter', desc: 'Propose swap sessions. Accept, reject, or schedule — all in one place.' },
  { icon: '📹', title: 'Video Sessions', desc: 'Jump into a Jitsi video call directly from an accepted swap request.' },
  { icon: '⭐', title: 'Reputation', desc: 'Rate partners after sessions. Build a verified track record over time.' },
]

export default function Landing() {
  const { token } = useAuth()
  return (
    <>
      <section className="hero">
        <div>
          <div className="hero-badge">🎓 Built for students, by students</div>
          <h1>Trade skills,<br />grow together.</h1>
          <p>SkillSwap connects you with peers who have the skills you want — and want the skills you have.</p>
          <div style={{display:'flex',gap:'1rem',justifyContent:'center',flexWrap:'wrap'}}>
            {token ? (
              <Link to="/dashboard" className="btn btn-primary" style={{fontSize:'1rem',padding:'.7rem 2rem'}}>Go to Dashboard →</Link>
            ) : (
              <>
                <Link to="/register" className="btn btn-primary" style={{fontSize:'1rem',padding:'.7rem 2rem'}}>Get Started Free</Link>
                <Link to="/login" className="btn" style={{fontSize:'1rem',padding:'.7rem 2rem',background:'rgba(255,255,255,.1)',color:'#fff'}}>Sign In</Link>
              </>
            )}
          </div>
        </div>
      </section>
      <div className="feature-grid">
        {FEATURES.map(f => <div className="feature-card" key={f.title}><div className="icon">{f.icon}</div><h3>{f.title}</h3><p>{f.desc}</p></div>)}
      </div>
    </>
  )
}
