import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import api from '../api/axios'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault(); setError(''); setLoading(true)
    try { const { data } = await api.post('/auth/login', form); login(data.token, data.user); navigate('/dashboard') }
    catch (err) { setError(err.response?.data?.message || 'Login failed') }
    finally { setLoading(false) }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <h2>Welcome back</h2>
        <p className="auth-sub">Sign in to your SkillSwap account</p>
        {error && <div className="alert alert-error">⚠ {error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group"><label className="form-label">Email</label><input className="form-input" name="email" type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} required placeholder="you@example.com" /></div>
          <div className="form-group"><label className="form-label">Password</label><input className="form-input" name="password" type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} required placeholder="••••••••" /></div>
          <button className="btn btn-primary btn-block mt-2" type="submit" disabled={loading}>{loading ? 'Signing in...' : 'Sign In'}</button>
        </form>
        <p className="auth-switch">Don't have an account? <Link to="/register">Create one</Link></p>
      </div>
    </div>
  )
}
