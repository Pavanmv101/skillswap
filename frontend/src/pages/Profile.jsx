import { useEffect, useState } from 'react'
import api from '../api/axios'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import Spinner from '../components/Spinner'
import Avatar from '../components/Avatar'
import AvailabilityCalendar from '../components/AvailabilityCalendar'

const CATEGORIES = ['General', 'Programming', 'Design', 'Music', 'Language', 'Sports', 'Academic', 'Business', 'Other']
const LEVELS     = ['Beginner', 'Intermediate', 'Advanced']
const PRIORITIES = ['Low', 'Medium', 'High']
const DAYS       = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export default function Profile() {
  const { user, login } = useAuth()
  const { addToast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')

  const [name, setName] = useState('')
  const [bio,  setBio]  = useState('')
  const [skillsOffered, setSkillsOffered] = useState([])
  const [skillsWanted,  setSkillsWanted]  = useState([])
  const [slots,         setSlots]         = useState([])

  useEffect(() => {
    async function load() {
      try {
        const { data } = await api.get('/profile')
        setName(data.name || '')
        setBio(data.bio   || '')
        setSkillsOffered(data.skillsOffered || [])
        setSkillsWanted(data.skillsWanted   || [])
        setSlots(data.availabilitySlots     || [])
      } catch (err) {
        setError('Failed to load profile')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // ── Offered skills helpers ───────────────────────
  function addOffered() {
    setSkillsOffered([...skillsOffered, { skill: '', category: 'Programming', level: 'Intermediate' }])
  }
  function updateOffered(i, field, val) {
    const copy = [...skillsOffered]
    copy[i] = { ...copy[i], [field]: val }
    setSkillsOffered(copy)
  }
  function removeOffered(i) {
    setSkillsOffered(skillsOffered.filter((_, idx) => idx !== i))
  }

  // ── Wanted skills helpers ────────────────────────
  function addWanted() {
    setSkillsWanted([...skillsWanted, { skill: '', category: 'Programming', priority: 'High' }])
  }
  function updateWanted(i, field, val) {
    const copy = [...skillsWanted]
    copy[i] = { ...copy[i], [field]: val }
    setSkillsWanted(copy)
  }
  function removeWanted(i) {
    setSkillsWanted(skillsWanted.filter((_, idx) => idx !== i))
  }

  // ── Availability slot helpers ────────────────────
  function addSlot() {
    setSlots([...slots, { day: 'Monday', from: '18:00', to: '20:00' }])
  }
  function updateSlot(i, field, val) {
    const copy = [...slots]
    copy[i] = { ...copy[i], [field]: val }
    setSlots(copy)
  }
  function removeSlot(i) {
    setSlots(slots.filter((_, idx) => idx !== i))
  }

  // ── Save ─────────────────────────────────────────
  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setError('')

    // Validate slots
    for (const s of slots) {
      if (s.from >= s.to) {
        const msg = `Invalid time slot on ${s.day}: Start time (${s.from}) must be earlier than end time (${s.to})`
        setError(msg)
        addToast(msg, 'warning')
        setSaving(false)
        return
      }
    }

    const offered = skillsOffered.filter(s => s.skill.trim())
    const wanted  = skillsWanted.filter(s => s.skill.trim())

    try {
      const { data } = await api.put('/profile', {
        name,
        bio,
        skillsOffered: offered,
        skillsWanted:  wanted,
        availabilitySlots: slots,
      })
      setSkillsOffered(data.skillsOffered || offered)
      setSkillsWanted(data.skillsWanted   || wanted)

      // Update auth context name
      login(localStorage.getItem('token'), { ...user, name: data.name })
      addToast('Profile changes saved successfully! ✨', 'success')
    } catch (err) {
      const msg = err.response?.data?.message || 'Failed to save profile'
      setError(msg)
      addToast(msg, 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Spinner message="Loading your profile…" />

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <div className="page-header-flex">
        <div>
          <h2 className="page-title">Edit Your Profile</h2>
          <p className="page-sub">
            Keep your skills and availability updated so peers can discover and match with you.
          </p>
        </div>
      </div>

      {error && <div className="alert alert-error">⚠ {error}</div>}

      <form onSubmit={handleSave}>
        {/* Personal Details Card */}
        <div className="card profile-section-card">
          <div className="profile-top-row">
            <Avatar name={name || user?.name} size={64} />
            <div style={{ flex: 1 }}>
              <div className="form-group">
                <label className="form-label">Full Name</label>
                <input
                  className="form-input"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                />
              </div>
            </div>
          </div>

          <div className="form-group" style={{ marginTop: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '.35rem' }}>
              <label className="form-label" style={{ margin: 0 }}>Short Bio</label>
              <span style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>{bio.length}/300</span>
            </div>
            <textarea
              className="form-textarea"
              rows={3}
              maxLength={300}
              value={bio}
              onChange={e => setBio(e.target.value)}
              placeholder="Tell others what you are studying, your interests, or what projects you are building…"
            />
          </div>
        </div>

        {/* Skills I Can Teach */}
        <div className="card profile-section-card" style={{ marginTop: '1.5rem' }}>
          <div className="section-title-row">
            <div>
              <h3 style={{ margin: 0 }}>📚 Skills I Can Teach</h3>
              <p style={{ margin: '.2rem 0 0', fontSize: '.82rem', color: 'var(--text-muted)' }}>
                These skills will be matched against what other students are looking to learn.
              </p>
            </div>
            <button type="button" className="btn btn-muted btn-sm" onClick={addOffered}>
              + Add Skill
            </button>
          </div>

          <div style={{ marginTop: '1rem' }}>
            {skillsOffered.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '.88rem', fontStyle: 'italic' }}>
                No teaching skills added yet. Click "+ Add Skill" to add your first one.
              </p>
            ) : (
              skillsOffered.map((s, i) => (
                <div className="skill-row" key={i}>
                  <input
                    className="form-input"
                    placeholder="e.g. React, Python, UI/UX"
                    value={s.skill}
                    onChange={e => updateOffered(i, 'skill', e.target.value)}
                    required
                  />
                  <select
                    className="form-select"
                    value={s.category}
                    onChange={e => updateOffered(i, 'category', e.target.value)}
                  >
                    {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                  <select
                    className="form-select"
                    value={s.level}
                    onChange={e => updateOffered(i, 'level', e.target.value)}
                  >
                    {LEVELS.map(l => <option key={l}>{l}</option>)}
                  </select>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    title="Remove skill"
                    onClick={() => removeOffered(i)}
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Skills I Want to Learn */}
        <div className="card profile-section-card" style={{ marginTop: '1.5rem' }}>
          <div className="section-title-row">
            <div>
              <h3 style={{ margin: 0 }}>🎯 Skills I Want to Learn</h3>
              <p style={{ margin: '.2rem 0 0', fontSize: '.82rem', color: 'var(--text-muted)' }}>
                We'll search the network and rank users who teach these skills.
              </p>
            </div>
            <button type="button" className="btn btn-muted btn-sm" onClick={addWanted}>
              + Add Skill
            </button>
          </div>

          <div style={{ marginTop: '1rem' }}>
            {skillsWanted.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '.88rem', fontStyle: 'italic' }}>
                No wanted skills added yet. Add what you want to learn so we can calculate your matches!
              </p>
            ) : (
              skillsWanted.map((s, i) => (
                <div className="skill-row" key={i}>
                  <input
                    className="form-input"
                    placeholder="e.g. Machine Learning, Figma, Guitar"
                    value={s.skill}
                    onChange={e => updateWanted(i, 'skill', e.target.value)}
                    required
                  />
                  <select
                    className="form-select"
                    value={s.category}
                    onChange={e => updateWanted(i, 'category', e.target.value)}
                  >
                    {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                  <select
                    className="form-select"
                    value={s.priority}
                    onChange={e => updateWanted(i, 'priority', e.target.value)}
                  >
                    {PRIORITIES.map(p => <option key={p}>{p} Priority</option>)}
                  </select>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    title="Remove skill"
                    onClick={() => removeWanted(i)}
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Availability Schedule */}
        <div className="card profile-section-card" style={{ marginTop: '1.5rem' }}>
          <div className="section-title-row">
            <div>
              <h3 style={{ margin: 0 }}>⏰ Weekly Availability Schedule</h3>
              <p style={{ margin: '.2rem 0 0', fontSize: '.82rem', color: 'var(--text-muted)' }}>
                Used to compute schedule overlap badges with matching peers.
              </p>
            </div>
            <button type="button" className="btn btn-muted btn-sm" onClick={addSlot}>
              + Add Time Slot
            </button>
          </div>

          <div style={{ marginTop: '1rem' }}>
            {slots.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '.88rem', fontStyle: 'italic' }}>
                No time slots specified. Add your free hours so peers know when you can video call.
              </p>
            ) : (
              slots.map((s, i) => (
                <div className="skill-row" key={i}>
                  <select
                    className="form-select"
                    value={s.day}
                    onChange={e => updateSlot(i, 'day', e.target.value)}
                  >
                    {DAYS.map(d => <option key={d}>{d}</option>)}
                  </select>
                  <input
                    className="form-input"
                    type="time"
                    value={s.from}
                    onChange={e => updateSlot(i, 'from', e.target.value)}
                    required
                  />
                  <span style={{ alignSelf: 'center', color: 'var(--text-muted)' }}>to</span>
                  <input
                    className="form-input"
                    type="time"
                    value={s.to}
                    onChange={e => updateSlot(i, 'to', e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    title="Remove slot"
                    onClick={() => removeSlot(i)}
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>

          {slots.length > 0 && (
            <div style={{ marginTop: '1.25rem' }}>
              <AvailabilityCalendar slots={slots} title="Your Weekly Visual Calendar Preview" />
            </div>
          )}
        </div>

        {/* Save Bar */}
        <div className="profile-save-bar">
          <button type="submit" className="btn btn-primary btn-lg shadow-glow" disabled={saving}>
            {saving ? 'Saving Profile Changes…' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  )
}
