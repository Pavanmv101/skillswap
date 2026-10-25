import { useEffect, useState } from 'react'
import api from '../api/axios'
import { useAuth } from '../context/AuthContext'
import Spinner from '../components/Spinner'

const CATEGORIES = ['General', 'Programming', 'Design', 'Music', 'Language', 'Sports', 'Academic', 'Business', 'Other']
const LEVELS     = ['Beginner', 'Intermediate', 'Advanced']
const PRIORITIES = ['Low', 'Medium', 'High']
const DAYS       = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export default function Profile() {
  const { user, login } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [msg,     setMsg]     = useState('')
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
      } finally { setLoading(false) }
    }
    load()
  }, [])

  // ── Offered skills helpers ───────────────────────
  function addOffered() {
    setSkillsOffered([...skillsOffered, { skill: '', category: 'General', level: 'Beginner' }])
  }
  function updateOffered(i, field, val) {
    const copy = [...skillsOffered]; copy[i] = { ...copy[i], [field]: val }; setSkillsOffered(copy)
  }
  function removeOffered(i) { setSkillsOffered(skillsOffered.filter((_, idx) => idx !== i)) }

  // ── Wanted skills helpers ────────────────────────
  function addWanted() {
    setSkillsWanted([...skillsWanted, { skill: '', category: 'General', priority: 'Medium' }])
  }
  function updateWanted(i, field, val) {
    const copy = [...skillsWanted]; copy[i] = { ...copy[i], [field]: val }; setSkillsWanted(copy)
  }
  function removeWanted(i) { setSkillsWanted(skillsWanted.filter((_, idx) => idx !== i)) }

  // ── Availability slot helpers ────────────────────
  function addSlot() { setSlots([...slots, { day: 'Monday', from: '09:00', to: '10:00' }]) }
  function updateSlot(i, field, val) {
    const copy = [...slots]; copy[i] = { ...copy[i], [field]: val }; setSlots(copy)
  }
  function removeSlot(i) { setSlots(slots.filter((_, idx) => idx !== i)) }

  // ── Save ─────────────────────────────────────────
  async function handleSave(e) {
    e.preventDefault(); setSaving(true); setMsg(''); setError('')
    // Filter out empty skill names
    const offered = skillsOffered.filter(s => s.skill.trim())
    const wanted  = skillsWanted.filter(s => s.skill.trim())
    try {
      const { data } = await api.put('/profile', {
        name, bio,
        skillsOffered: offered,
        skillsWanted:  wanted,
        availabilitySlots: slots,
      })
      setSkillsOffered(data.skillsOffered || offered)
      setSkillsWanted(data.skillsWanted   || wanted)
      // Update context with new name
      login(localStorage.getItem('token'), { ...user, name: data.name })
      setMsg('Profile saved ✓')
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save profile')
    } finally { setSaving(false) }
  }

  if (loading) return <Spinner message="Loading profile…" />

  return (
    <div className="page" style={{ maxWidth: 700 }}>
      <h2>My Profile</h2>
      {msg   && <div className="alert alert-success">✅ {msg}</div>}
      {error && <div className="alert alert-error">⚠ {error}</div>}

      <form onSubmit={handleSave}>
        {/* Name & Bio */}
        <div className="form-group">
          <label className="form-label">Name</label>
          <input className="form-input" value={name} onChange={e => setName(e.target.value)} required />
        </div>
        <div className="form-group">
          <label className="form-label">Bio <span style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>({bio.length}/300)</span></label>
          <textarea className="form-textarea" rows={3} maxLength={300} value={bio} onChange={e => setBio(e.target.value)} placeholder="Tell others about yourself…" />
        </div>

        {/* Skills I Can Teach */}
        <h3 style={{ marginTop: '1.5rem' }}>Skills I Can Teach</h3>
        {skillsOffered.map((s, i) => (
          <div className="skill-row" key={i}>
            <input className="form-input" placeholder="Skill name" value={s.skill} onChange={e => updateOffered(i, 'skill', e.target.value)} />
            <select className="form-select" value={s.category} onChange={e => updateOffered(i, 'category', e.target.value)}>
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
            <select className="form-select" value={s.level} onChange={e => updateOffered(i, 'level', e.target.value)}>
              {LEVELS.map(l => <option key={l}>{l}</option>)}
            </select>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => removeOffered(i)}>✕</button>
          </div>
        ))}
        <button type="button" className="btn btn-muted btn-sm" onClick={addOffered} style={{ marginTop: '.5rem' }}>+ Add Skill</button>

        {/* Skills I Want to Learn */}
        <h3 style={{ marginTop: '1.5rem' }}>Skills I Want to Learn</h3>
        {skillsWanted.map((s, i) => (
          <div className="skill-row" key={i}>
            <input className="form-input" placeholder="Skill name" value={s.skill} onChange={e => updateWanted(i, 'skill', e.target.value)} />
            <select className="form-select" value={s.category} onChange={e => updateWanted(i, 'category', e.target.value)}>
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
            <select className="form-select" value={s.priority} onChange={e => updateWanted(i, 'priority', e.target.value)}>
              {PRIORITIES.map(p => <option key={p}>{p}</option>)}
            </select>
            <button type="button" className="btn btn-danger btn-sm" onClick={() => removeWanted(i)}>✕</button>
          </div>
        ))}
        <button type="button" className="btn btn-muted btn-sm" onClick={addWanted} style={{ marginTop: '.5rem' }}>+ Add Skill</button>

        {/* Availability Slots */}
        <h3 style={{ marginTop: '1.5rem' }}>Availability</h3>
        {slots.map((s, i) => (
          <div className="skill-row" key={i}>
            <select className="form-select" value={s.day} onChange={e => updateSlot(i, 'day', e.target.value)}>
              {DAYS.map(d => <option key={d}>{d}</option>)}
            </select>
            <input className="form-input" type="time" value={s.from} onChange={e => updateSlot(i, 'from', e.target.value)} />
            <span style={{ alignSelf: 'center' }}>to</span>
            <input className="form-input" type="time" value={s.to} onChange={e => updateSlot(i, 'to', e.target.value)} />
            <button type="button" className="btn btn-danger btn-sm" onClick={() => removeSlot(i)}>✕</button>
          </div>
        ))}
        <button type="button" className="btn btn-muted btn-sm" onClick={addSlot} style={{ marginTop: '.5rem' }}>+ Add Time Slot</button>

        {/* Save */}
        <div style={{ marginTop: '2rem' }}>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  )
}
