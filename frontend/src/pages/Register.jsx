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
  IconUser,
  IconArrowRight,
  IconCheck,
  IconSparkles
} from '../components/Icons'

const POPULAR_SKILLS = [
  'React',
  'Python',
  'JavaScript',
  'Node.js',
  'UI/UX Design',
  'TypeScript',
  'Data Science',
  'Machine Learning',
  'Guitar',
  'French',
  'Public Speaking',
  'Figma'
]

export default function Register() {
  const { login } = useAuth()
  const { addToast } = useToast()
  const navigate = useNavigate()

  // Form State
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Skill Selection
  const [teachSkills, setTeachSkills] = useState(['React'])
  const [learnSkills, setLearnSkills] = useState(['Python'])
  const [customSkillInput, setCustomSkillInput] = useState('')
  const [skillTarget, setSkillTarget] = useState('teach') // 'teach' or 'learn'

  // Password validation checks
  const hasMinLength = form.password.length >= 6
  const hasLetter = /[a-zA-Z]/.test(form.password)
  const hasNumber = /[0-9]/.test(form.password)

  function toggleSkill(skill, target) {
    if (target === 'teach') {
      if (teachSkills.includes(skill)) {
        setTeachSkills(teachSkills.filter(s => s !== skill))
      } else {
        setTeachSkills([...teachSkills, skill])
      }
    } else {
      if (learnSkills.includes(skill)) {
        setLearnSkills(learnSkills.filter(s => s !== skill))
      } else {
        setLearnSkills([...learnSkills, skill])
      }
    }
  }

  function addCustomSkill(e) {
    e.preventDefault()
    const trimmed = customSkillInput.trim()
    if (!trimmed) return
    if (skillTarget === 'teach') {
      if (!teachSkills.includes(trimmed)) setTeachSkills([...teachSkills, trimmed])
    } else {
      if (!learnSkills.includes(trimmed)) setLearnSkills([...learnSkills, trimmed])
    }
    setCustomSkillInput('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (!form.name.trim()) {
      setError('Please provide your full name.')
      return
    }

    if (!form.email.trim() || !form.email.includes('@')) {
      setError('Please provide a valid email address.')
      return
    }

    if (!hasMinLength) {
      setError('Password must be at least 6 characters in length.')
      return
    }

    setLoading(true)
    try {
      // 1. Primary Registration API Call
      const { data } = await api.post('/auth/register', {
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password
      })

      login(data.token, data.user)

      // 2. Pre-seed selected initial skills via profile update
      let skillsSaved = true
      if (teachSkills.length > 0 || learnSkills.length > 0) {
        try {
          await api.put(
            '/profile',
            {
              skillsOffered: teachSkills.map(s => ({
                skill: s,
                category: 'General',
                level: 'Intermediate',
                description: `Experienced peer tutor in ${s}`
              })),
              skillsWanted: learnSkills.map(s => ({
                skill: s,
                category: 'General',
                level: 'Beginner'
              }))
            },
            { headers: { Authorization: `Bearer ${data.token}` } }
          )
        } catch (profileErr) {
          skillsSaved = false
          addToast('Account created! However, your initial skills could not be saved automatically. You can add them anytime in your Profile.', 'warning')
        }
      }

      if (skillsSaved) {
        addToast(`Welcome to SkillSwap, ${data.user.name}! Your workspace is ready.`, 'success')
      }
      navigate('/dashboard')
    } catch (err) {
      const msg = err.response?.data?.message
        || (err.code === 'ECONNABORTED' ? err.message : null)
        || (!err.response ? err.message : null)
        || 'Registration failed. Please check your information.'
      setError(msg)
      addToast(msg, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-cinematic-shell">
      <div className="auth-ambient-halo" />
      <div className="auth-card-wrapper auth-register-wrapper">
        <div className="auth-glass-card auth-card-wide">
          {/* Header */}
          <div className="auth-header">
            <Link to="/" className="auth-brand-link" title="SkillSwap Home">
              <div className="brand-icon-halo">
                <IconLogo size={32} />
              </div>
              <span className="brand-name">SkillSwap</span>
            </Link>
            <h1 className="auth-title">Create your peer account</h1>
            <p className="auth-subtitle">
              Join students and independent mentors exchanging skills without fees
            </p>
          </div>

          {/* Error Banner */}
          {error && (
            <div className="auth-alert-banner alert-error" role="alert">
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="auth-form" noValidate>
            {/* Account Credentials */}
            <div className="register-grid-two-col">
              <div className="form-field-group">
                <label className="form-field-label" htmlFor="register-name">
                  Full Name
                </label>
                <div className="input-with-icon-wrap">
                  <IconUser size={18} className="input-leading-icon" />
                  <input
                    id="register-name"
                    className="auth-text-input"
                    name="name"
                    type="text"
                    autoComplete="name"
                    value={form.name}
                    onChange={e => setForm({ ...form, name: e.target.value })}
                    required
                    placeholder="e.g. Alex Chen"
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="form-field-group">
                <label className="form-field-label" htmlFor="register-email">
                  College or Personal Email
                </label>
                <div className="input-with-icon-wrap">
                  <IconMail size={18} className="input-leading-icon" />
                  <input
                    id="register-email"
                    className="auth-text-input"
                    name="email"
                    type="email"
                    autoComplete="email"
                    value={form.email}
                    onChange={e => setForm({ ...form, email: e.target.value })}
                    required
                    placeholder="you@university.edu"
                    disabled={loading}
                  />
                </div>
              </div>
            </div>

            <div className="form-field-group">
              <div className="field-label-row">
                <label className="form-field-label" htmlFor="register-password">
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
                  id="register-password"
                  className="auth-text-input"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  required
                  placeholder="At least 6 characters"
                  disabled={loading}
                />
              </div>

              {/* Password Requirement Badges */}
              <div className="password-hints-row">
                <span className={`pass-badge ${hasMinLength ? 'pass-valid' : ''}`}>
                  <IconCheck size={12} /> 6+ characters
                </span>
                <span className={`pass-badge ${hasLetter ? 'pass-valid' : ''}`}>
                  <IconCheck size={12} /> Letters
                </span>
                <span className={`pass-badge ${hasNumber ? 'pass-valid' : ''}`}>
                  <IconCheck size={12} /> Numbers
                </span>
              </div>
            </div>

            {/* Initial Skills Preference Selector */}
            <div className="register-skills-selector-card">
              <div className="skills-selector-header">
                <div className="skills-selector-title">
                  <IconSparkles size={16} />
                  <span>INITIAL SKILL PREFERENCES</span>
                </div>
                <span className="skills-selector-sub">Select what you can teach and want to learn</span>
              </div>

              {/* Toggle Target */}
              <div className="skills-target-toggle">
                <button
                  type="button"
                  className={`skill-target-btn ${skillTarget === 'teach' ? 'active-teach' : ''}`}
                  onClick={() => setSkillTarget('teach')}
                >
                  I Can Teach ({teachSkills.length})
                </button>
                <button
                  type="button"
                  className={`skill-target-btn ${skillTarget === 'learn' ? 'active-learn' : ''}`}
                  onClick={() => setSkillTarget('learn')}
                >
                  I Want to Learn ({learnSkills.length})
                </button>
              </div>

              {/* Suggestion Pills */}
              <div className="skills-pill-cloud">
                {POPULAR_SKILLS.map(skill => {
                  const isSelected = skillTarget === 'teach' ? teachSkills.includes(skill) : learnSkills.includes(skill)
                  return (
                    <button
                      key={skill}
                      type="button"
                      className={`skill-cloud-pill ${isSelected ? 'pill-selected' : ''}`}
                      onClick={() => toggleSkill(skill, skillTarget)}
                    >
                      {isSelected ? <IconCheck size={12} /> : '+'} {skill}
                    </button>
                  )
                })}
              </div>

              {/* Custom Skill Input */}
              <div className="custom-skill-input-row" style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
                <input
                  type="text"
                  className="auth-text-input"
                  style={{ padding: '0.5rem 0.75rem' }}
                  placeholder={`Add another skill to ${skillTarget}...`}
                  value={customSkillInput}
                  onChange={(e) => setCustomSkillInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addCustomSkill(e) }}
                />
                <button
                  type="button"
                  className="btn-cinematic-secondary"
                  style={{ padding: '0.5rem 1rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                  onClick={addCustomSkill}
                >
                  Add Skill
                </button>
              </div>

              {/* Selected Summary */}
              <div className="skills-selected-summary">
                <div className="summary-col">
                  <span className="summary-label">Teaching:</span>
                  <div className="summary-tags">
                    {teachSkills.length > 0 ? (
                      teachSkills.map(s => (
                        <span key={s} className="summary-tag teach-pill">
                          {s} <span onClick={() => toggleSkill(s, 'teach')}>×</span>
                        </span>
                      ))
                    ) : (
                      <span className="summary-placeholder">None selected yet</span>
                    )}
                  </div>
                </div>

                <div className="summary-col">
                  <span className="summary-label">Learning:</span>
                  <div className="summary-tags">
                    {learnSkills.length > 0 ? (
                      learnSkills.map(s => (
                        <span key={s} className="summary-tag learn-pill">
                          {s} <span onClick={() => toggleSkill(s, 'learn')}>×</span>
                        </span>
                      ))
                    ) : (
                      <span className="summary-placeholder">None selected yet</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <button
              className="btn-cinematic-primary btn-block auth-submit-btn"
              type="submit"
              disabled={loading}
            >
              {loading ? (
                <span className="btn-loading-state">
                  <span className="auth-spinner" /> Setting up your workspace…
                </span>
              ) : (
                <span className="btn-label-state">
                  Complete Registration <IconArrowRight size={17} />
                </span>
              )}
            </button>
          </form>

          {/* Navigation to Login */}
          <div className="auth-footer-nav">
            <span>Already have an account?</span>{' '}
            <Link to="/login" className="auth-link-bold">
              Sign in to your account
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
