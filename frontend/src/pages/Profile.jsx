import { useEffect, useState } from 'react'
import api from '../api/axios'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import Spinner from '../components/Spinner'
import Avatar from '../components/Avatar'
import AvailabilityCalendar from '../components/AvailabilityCalendar'
import VerificationModal from '../components/VerificationModal'

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

  // Phase 3: Verification & Endorsement state
  const [myVerifications, setMyVerifications] = useState([])
  const [myEndorsements,  setMyEndorsements]  = useState([])
  const [verifyModalOpen, setVerifyModalOpen] = useState(false)
  const [selectedSkill,   setSelectedSkill]   = useState(null)

  async function loadProfileAndTrustData() {
    try {
      const [profRes, verifRes] = await Promise.all([
        api.get('/profile'),
        api.get('/verification/my').catch(() => ({ data: [] })),
      ])
      const data = profRes.data
      setName(data.name || '')
      setBio(data.bio   || '')
      setSkillsOffered(data.skillsOffered || [])
      setSkillsWanted(data.skillsWanted   || [])
      setSlots(data.availabilitySlots     || [])
      setMyVerifications(verifRes.data || [])

      const userId = data._id || user?.id
      if (userId) {
        const endRes = await api.get(`/endorsements/${userId}`).catch(() => ({ data: { endorsements: [] } }))
        setMyEndorsements(endRes.data?.endorsements || (Array.isArray(endRes.data) ? endRes.data : []))
      }
    } catch (err) {
      setError('Failed to load profile')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadProfileAndTrustData()
  }, [])

  // ── Offered skills helpers ───────────────────────
  function addOffered() {
    setSkillsOffered([...skillsOffered, { skill: '', category: 'Programming', level: 'Intermediate', verified: false }])
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

  // ── Verification modal trigger ───────────────────
  function handleOpenVerification(skillObj) {
    if (!skillObj.skill?.trim()) {
      addToast('Please name the skill and save before requesting verification', 'warning')
      return
    }
    setSelectedSkill(skillObj)
    setVerifyModalOpen(true)
  }

  // Helper to count peer endorsements for a skill
  function getEndorsementCount(skillName) {
    if (!skillName) return 0
    return myEndorsements.filter(e => e.skillName?.toLowerCase() === skillName.toLowerCase()).length
  }

  // Helper to find latest verification for a skill
  function getSkillVerification(skillName) {
    if (!skillName) return null
    return myVerifications.find(v => v.skillName?.toLowerCase() === skillName.toLowerCase())
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
    <div className="page" style={{ maxWidth: 780 }}>
      <div className="page-header-flex">
        <div>
          <h2 className="page-title">Edit Your Profile</h2>
          <p className="page-sub">
            Keep your skills, verified credentials, and availability updated so peers can discover and match with you.
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
              skillsOffered.map((s, i) => {
                const verif = getSkillVerification(s.skill)
                const endCount = getEndorsementCount(s.skill)
                const isVerified = s.verified || verif?.status === 'verified'

                return (
                  <div key={i} className="skill-edit-card" style={{ marginBottom: '1rem', padding: '.85rem', background: 'rgba(255,255,255,0.02)', borderRadius: 10, border: '1px solid var(--border-color)' }}>
                    <div className="skill-row" style={{ marginBottom: '.5rem' }}>
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

                    {/* Trust & Verification Badges Bar for this skill */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem', paddingTop: '.35rem', borderTop: '1px dashed rgba(255,255,255,0.06)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                        {isVerified ? (
                          <span className="badge badge-verified" title="Skill officially verified by SkillSwap administrator">
                            ✓ Verified
                          </span>
                        ) : verif?.status === 'pending' ? (
                          <span className="badge badge-pending" title="Your verification application is currently under admin review">
                            ⏳ Under Review
                          </span>
                        ) : verif?.status === 'rejected' ? (
                          <span className="badge badge-rejected" title={verif.rejectionReason || 'Application rejected'}>
                            ✕ Rejected
                          </span>
                        ) : (
                          <span style={{ fontSize: '.78rem', color: 'var(--text-muted)' }}>
                            Not verified yet
                          </span>
                        )}

                        {endCount > 0 && (
                          <span className="endorsement-pill" title={`${endCount} peer endorsement(s) received from completed swaps`}>
                            ★ {endCount} {endCount === 1 ? 'Endorsement' : 'Endorsements'}
                          </span>
                        )}
                      </div>

                      {/* Verification Action Buttons */}
                      <div>
                        {isVerified ? (
                          <span style={{ fontSize: '.78rem', color: '#10b981' }}>Credibility active</span>
                        ) : verif?.status === 'pending' ? (
                          <span style={{ fontSize: '.78rem', color: '#f59e0b' }}>Awaiting admin review</span>
                        ) : verif?.status === 'rejected' ? (
                          <button
                            type="button"
                            className="btn btn-outline btn-xs"
                            onClick={() => handleOpenVerification(s)}
                            style={{ borderColor: '#ef4444', color: '#ef4444' }}
                          >
                            Resubmit Evidence ↻
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-outline btn-xs"
                            onClick={() => handleOpenVerification(s)}
                          >
                            🛡️ Request Verification
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })
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

      {/* Verification Applications History Section */}
      {myVerifications.length > 0 && (
        <div className="card" style={{ marginTop: '1.5rem' }}>
          <h3 style={{ margin: '0 0 .5rem', fontSize: '1.05rem' }}>🛡️ My Skill Verification Applications</h3>
          <p style={{ margin: '0 0 1rem', fontSize: '.82rem', color: 'var(--text-muted)' }}>
            Track the status of your submitted credentials, GitHub projects, and certificates reviewed by administrators.
          </p>

          <div className="card-list">
            {myVerifications.map(v => (
              <div key={v._id} className="verification-history-card" style={{ padding: '.9rem', background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px solid var(--border-color)', marginBottom: '.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '.5rem' }}>
                  <div>
                    <strong style={{ fontSize: '1rem', color: 'var(--text-color)' }}>{v.skillName}</strong>
                    <span style={{ marginLeft: '.5rem', fontSize: '.75rem', padding: '2px 8px', borderRadius: 4, background: 'rgba(255,255,255,0.06)' }}>
                      {v.category}
                    </span>
                    <span style={{ marginLeft: '.5rem', fontSize: '.75rem', color: 'var(--text-muted)' }}>
                      Evidence: {v.evidenceType}
                    </span>
                  </div>
                  <div>
                    {v.status === 'verified' && <span className="badge badge-verified">✓ Approved</span>}
                    {v.status === 'pending' && <span className="badge badge-pending">⏳ Pending Review</span>}
                    {v.status === 'rejected' && <span className="badge badge-rejected">✕ Rejected</span>}
                  </div>
                </div>

                {v.description && (
                  <p style={{ margin: '.4rem 0', fontSize: '.84rem', color: 'var(--text-muted)' }}>
                    {v.description}
                  </p>
                )}

                {v.status === 'rejected' && v.rejectionReason && (
                  <div style={{ marginTop: '.5rem', padding: '.6rem .75rem', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, fontSize: '.82rem', color: '#ef4444' }}>
                    <strong>Admin Feedback:</strong> {v.rejectionReason}
                    <div style={{ marginTop: '.4rem' }}>
                      <button
                        type="button"
                        className="btn btn-outline btn-xs"
                        onClick={() => handleOpenVerification({ skill: v.skillName, category: v.category })}
                        style={{ borderColor: '#ef4444', color: '#ef4444' }}
                      >
                        Resubmit Application ↻
                      </button>
                    </div>
                  </div>
                )}

                <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', marginTop: '.5rem' }}>
                  Submitted on {new Date(v.createdAt).toLocaleDateString([], { dateStyle: 'medium' })}
                  {v.reviewedAt && ` • Reviewed on ${new Date(v.reviewedAt).toLocaleDateString([], { dateStyle: 'medium' })}`}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Verification Evidence Submission Modal */}
      <VerificationModal
        isOpen={verifyModalOpen}
        skill={selectedSkill}
        onClose={() => setVerifyModalOpen(false)}
        onSuccess={() => {
          loadProfileAndTrustData()
          addToast('Verification evidence submitted successfully for admin review! 🛡️', 'success')
        }}
      />
    </div>
  )
}
