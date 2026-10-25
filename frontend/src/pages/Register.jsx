import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import api from '../api/axios'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'

export default function Register() {
  const { login } = useAuth()
  const { addToast } = useToast()
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (form.password.length < 6) {
      return setError('Password must be at least 6 characters.')
    }
    setLoading(true)
    try {
      const { data } = await api.post('/auth/register', form)
      login(data.token, data.user)
      addToast(`Account created! Let's setup your skills, ${data.user.name}. 🚀`, 'success')
      navigate('/profile')
    } catch (err) {
      const msg = err.response?.data?.message || 'Registration failed'
      setError(msg)
      addToast(msg, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand-badge">
          <span className="brand-logo">⚡</span>
          <span>SkillSwap Network</span>
        </div>

        <h2 className="auth-heading">Create your student account</h2>
        <p className="auth-sub">Join peers bartering knowledge & skills on campus</p>

        {error && <div className="alert alert-error">⚠ {error}</div>}

        <form onSubmit={handleSubmit} style={{ marginTop: '1.25rem' }}>
          <div className="form-group">
            <label className="form-label">Full Name</label>
            <input
              className="form-input"
              value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })}
              required
              placeholder="e.g. Alex Johnson"
            />
          </div>

          <div className="form-group">
            <label className="form-label">College / Personal Email</label>
            <input
              className="form-input"
              type="email"
              value={form.email}
              onChange={e => setForm({ ...form, email: e.target.value })}
              required
              placeholder="you@college.edu"
            />
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              className="form-input"
              type="password"
              value={form.password}
              onChange={e => setForm({ ...form, password: e.target.value })}
              required
              placeholder="Minimum 6 characters"
            />
          </div>

          <button
            className="btn btn-primary btn-block shadow-glow"
            style={{ padding: '.75rem', marginTop: '.75rem', fontSize: '.95rem' }}
            type="submit"
            disabled={loading}
          >
            {loading ? 'Creating Account…' : 'Get Started Free →'}
          </button>
        </form>

        <p className="auth-switch">
          Already have an account? <Link to="/login" className="auth-link">Sign in here</Link>
        </p>
      </div>
    </div>
  )
}
