import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import api from '../api/axios'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'

export default function Login() {
  const { login } = useAuth()
  const { addToast } = useToast()
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data } = await api.post('/auth/login', form)
      login(data.token, data.user)
      addToast(`Welcome back, ${data.user.name}! 👋`, 'success')
      navigate('/dashboard')
    } catch (err) {
      const msg = err.response?.data?.message || 'Login failed. Please check your credentials.'
      setError(msg)
      addToast(msg, 'error')
    } finally {
      setLoading(false)
    }
  }

  // Quick 1-click fill for evaluator demo
  function fillDemo(email, password) {
    setForm({ email, password })
    setError('')
    addToast(`Filled demo student credentials (${email})`, 'info')
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand-badge">
          <span className="brand-logo">⚡</span>
          <span>SkillSwap Auth</span>
        </div>

        <h2 className="auth-heading">Welcome back</h2>
        <p className="auth-sub">Sign in to manage your skill exchanges & active sessions</p>

        {error && <div className="alert alert-error">⚠ {error}</div>}

        <form onSubmit={handleSubmit} style={{ marginTop: '1.25rem' }}>
          <div className="form-group">
            <label className="form-label">College Email Address</label>
            <input
              className="form-input"
              name="email"
              type="email"
              value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })}
              required
              placeholder="name@college.edu or demo@skillswap.com"
            />
          </div>

          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '.35rem' }}>
              <label className="form-label" style={{ margin: 0 }}>Password</label>
              <button
                type="button"
                className="link-subtle"
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '.78rem' }}
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <input
              className="form-input"
              name="password"
              type={showPassword ? 'text' : 'password'}
              value={form.password}
              onChange={e => setForm({ ...form, password: e.target.value })}
              required
              placeholder="••••••••"
            />
          </div>

          <button
            className="btn btn-primary btn-block shadow-glow"
            style={{ padding: '.75rem', marginTop: '.75rem', fontSize: '.95rem' }}
            type="submit"
            disabled={loading}
          >
            {loading ? 'Authenticating…' : 'Sign In to Dashboard →'}
          </button>
        </form>

        {/* Demo Accounts Quick-Fill for Academic Panel */}
        <div className="demo-accounts-box">
          <div className="demo-box-label">⚡ 1-Click Quick Demo Login:</div>
          <div className="demo-btn-row">
            <button
              type="button"
              className="demo-pill-btn"
              onClick={() => fillDemo('aarav@skillswap.com', 'password123')}
            >
              Aarav (React Tutor)
            </button>
            <button
              type="button"
              className="demo-pill-btn"
              onClick={() => fillDemo('priya@skillswap.com', 'password123')}
            >
              Priya (Python Tutor)
            </button>
          </div>
        </div>

        <p className="auth-switch">
          Don't have an account? <Link to="/register" className="auth-link">Create one for free</Link>
        </p>
      </div>
    </div>
  )
}
