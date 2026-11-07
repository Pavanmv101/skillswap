import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import api from '../api/axios'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import {
  IconLogo,
  IconEye,
  IconEyeOff,
  IconLock,
  IconMail,
  IconArrowRight,
  IconShield
} from '../components/Icons'

const DEMO_ACCOUNTS = [
  { name: 'Aarav Sharma', role: 'React Tutor', email: 'aarav@skillswap.com', password: 'password123' },
  { name: 'Priya Patel', role: 'Python Tutor', email: 'priya@skillswap.com', password: 'password123' },
  { name: 'Rohan Mehta', role: 'UI/UX Mentor', email: 'rohan@skillswap.com', password: 'password123' },
  { name: 'Admin Account', role: 'Administrator', email: 'admin@skillswap.com', password: 'password123', isAdmin: true }
]

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

    if (!form.email || !form.password) {
      setError('Please provide both your email address and password.')
      return
    }

    setLoading(true)
    try {
      const { data } = await api.post('/auth/login', form)
      login(data.token, data.user)
      addToast(`Welcome back, ${data.user.name}!`, 'success')
      navigate('/dashboard')
    } catch (err) {
      const msg = err.response?.data?.message || 'Login failed. Please check your credentials.'
      setError(msg)
      addToast(msg, 'error')
    } finally {
      setLoading(false)
    }
  }

  function fillDemo(acc) {
    setForm({ email: acc.email, password: acc.password })
    setError('')
    addToast(`Selected demo credentials for ${acc.name}`, 'info')
  }

  return (
    <div className="auth-page-container">
      <div className="auth-card-wrapper">
        <div className="auth-card">
          {/* Header */}
          <div className="auth-header">
            <Link to="/" className="auth-brand-link" title="SkillSwap Home">
              <IconLogo size={32} />
              <span className="brand-name">SkillSwap</span>
            </Link>
            <h1 className="auth-title">Welcome back</h1>
            <p className="auth-subtitle">
              Sign in to manage your active peer exchanges and learning roadmaps
            </p>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="auth-alert-banner alert-error" role="alert">
              <span>{error}</span>
            </div>
          )}

          {/* Login Form */}
          <form onSubmit={handleSubmit} className="auth-form" noValidate>
            <div className="form-field-group">
              <label className="form-field-label" htmlFor="login-email">
                Email Address
              </label>
              <div className="input-with-icon-wrap">
                <IconMail size={18} className="input-leading-icon" />
                <input
                  id="login-email"
                  className="auth-text-input"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  required
                  placeholder="name@college.edu or demo@skillswap.com"
                  disabled={loading}
                />
              </div>
            </div>

            <div className="form-field-group">
              <div className="field-label-row">
                <label className="form-field-label" htmlFor="login-password">
                  Password
                </label>
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={0}
                >
                  {showPassword ? (
                    <>
                      <IconEyeOff size={15} />
                      <span>Hide</span>
                    </>
                  ) : (
                    <>
                      <IconEye size={15} />
                      <span>Show</span>
                    </>
                  )}
                </button>
              </div>

              <div className="input-with-icon-wrap">
                <IconLock size={18} className="input-leading-icon" />
                <input
                  id="login-password"
                  className="auth-text-input"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  required
                  placeholder="••••••••••••"
                  disabled={loading}
                />
              </div>
            </div>

            <button
              className="btn btn-primary btn-block auth-submit-btn shadow-glow"
              type="submit"
              disabled={loading}
            >
              {loading ? (
                <span className="btn-loading-state">
                  <span className="auth-spinner" /> Authenticating…
                </span>
              ) : (
                <span className="btn-label-state">
                  Sign In to Workspace <IconArrowRight size={17} />
                </span>
              )}
            </button>
          </form>

          {/* Demo 1-Click Accounts Box */}
          <div className="demo-accounts-panel">
            <div className="demo-panel-header">
              <span className="demo-panel-label">1-CLICK DEMO ACCOUNTS</span>
              <span className="demo-panel-hint">Preloaded test profiles</span>
            </div>
            <div className="demo-accounts-grid">
              {DEMO_ACCOUNTS.map(acc => (
                <button
                  key={acc.email}
                  type="button"
                  className={`demo-account-pill ${acc.isAdmin ? 'demo-admin-pill' : ''}`}
                  onClick={() => fillDemo(acc)}
                  disabled={loading}
                  title={`Fill credentials for ${acc.name}`}
                >
                  <span className="demo-acc-name">
                    {acc.isAdmin && <IconShield size={13} className="admin-icon" />}
                    {acc.name.split(' ')[0]}
                  </span>
                  <span className="demo-acc-role">{acc.role}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Navigation to Registration */}
          <div className="auth-footer-nav">
            <span>New to SkillSwap?</span>{' '}
            <Link to="/register" className="auth-link-bold">
              Create a free peer account
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
