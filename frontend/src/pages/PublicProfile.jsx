import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import api from '../api/axios'
import Spinner from '../components/Spinner'
import Stars from '../components/Stars'
import Avatar from '../components/Avatar'
import SwapModal from '../components/SwapModal'
import EndorsementModal from '../components/EndorsementModal'
import AvailabilityCalendar from '../components/AvailabilityCalendar'
import { useToast } from '../context/ToastContext'

export default function PublicProfile() {
  const { id } = useParams()
  const { addToast } = useToast()
  const [profile, setProfile] = useState(null)
  const [myProfile, setMyProfile] = useState(null)
  const [ratings, setRatings] = useState([])
  const [endorsements, setEndorsements] = useState([])
  const [achievements, setAchievements] = useState([])
  const [loading, setLoading] = useState(true)
  const [swapModalOpen, setSwapModalOpen] = useState(false)
  const [endorseModalOpen, setEndorseModalOpen] = useState(false)
  const [blockModalOpen, setBlockModalOpen] = useState(false)
  const [blocking, setBlocking] = useState(false)
  const [error, setError] = useState('')

  async function loadData() {
    try {
      const [profileRes, ratingsRes, myProfileRes, endorsementsRes, achievementsRes] = await Promise.all([
        api.get(`/profile/${id}`),
        api.get(`/rating/user/${id}`),
        api.get('/profile').catch(() => ({ data: null })),
        api.get(`/endorsements/${id}`).catch(() => ({ data: [] })),
        api.get(`/learning/achievements/${id}`).catch(() => ({ data: [] })),
      ])
      setProfile(profileRes.data)
      setRatings(ratingsRes.data || [])
      setMyProfile(myProfileRes?.data)
      setEndorsements(endorsementsRes.data?.endorsements || (Array.isArray(endorsementsRes.data) ? endorsementsRes.data : []))
      setAchievements(achievementsRes.data || [])
    } catch (err) {
      setError('User profile not found')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [id])

  async function handleConfirmBlock() {
    setBlocking(true)
    try {
      await api.post(`/profile/block/${id}`)
      addToast(`User ${profile.name} blocked from matches`, 'info')
      setBlockModalOpen(false)
    } catch (err) {
      addToast(err.response?.data?.message || 'Failed to block user', 'error')
    } finally {
      setBlocking(false)
    }
  }

  // Count endorsements for a specific skill
  function getSkillEndorsementCount(skillName) {
    if (!skillName) return 0
    return endorsements.filter(e => e.skillName?.toLowerCase() === skillName.toLowerCase()).length
  }

  if (loading) return <Spinner message="Loading user profile…" />
  if (error) {
    return (
      <div className="page" style={{ maxWidth: 650 }}>
        <div className="alert alert-error">⚠ {error}</div>
        <Link to="/matches" className="btn btn-muted">← Back to Matches</Link>
      </div>
    )
  }

  const isSelf = myProfile && (myProfile._id === profile._id || myProfile.id === profile._id)

  return (
    <div className="page" style={{ maxWidth: 740 }}>
      <div style={{ marginBottom: '1.25rem' }}>
        <Link to="/matches" className="link-subtle">← Back to Matches</Link>
      </div>

      {/* Main Profile Hero Card */}
      <div className="card profile-header-card">
        <div className="public-profile-top">
          <Avatar name={profile.name} size={72} />
          <div style={{ flex: 1 }}>
            <h2 style={{ margin: '0 0 .25rem', fontSize: '1.6rem' }}>{profile.name}</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
              <Stars value={profile.averageRating} count={profile.totalRatings} />
              <span style={{ color: 'var(--text-muted)', fontSize: '.8rem' }}>•</span>
              <span style={{ fontSize: '.82rem', color: 'var(--text-muted)' }}>
                Member since {new Date(profile.createdAt).toLocaleDateString([], { month: 'short', year: 'numeric' })}
              </span>
              {endorsements.length > 0 && (
                <>
                  <span style={{ color: 'var(--text-muted)', fontSize: '.8rem' }}>•</span>
                  <span style={{ fontSize: '.82rem', color: '#f59e0b', fontWeight: 600 }}>
                    ★ {endorsements.length} Peer {endorsements.length === 1 ? 'Endorsement' : 'Endorsements'}
                  </span>
                </>
              )}
            </div>
            {profile.bio && <p className="public-bio">{profile.bio}</p>}
          </div>
        </div>

        <div className="public-actions-bar">
          {!isSelf && (
            <>
              <button
                className="btn btn-primary btn-md shadow-glow"
                onClick={() => setSwapModalOpen(true)}
              >
                ⚡ Propose Skill Swap
              </button>
              <button
                className="btn btn-outline btn-md"
                onClick={() => setEndorseModalOpen(true)}
                title="Endorse a skill taught by this peer after completing an exchange"
              >
                ⭐ Endorse Skill
              </button>
              <button
                className="btn btn-muted btn-sm"
                onClick={() => setBlockModalOpen(true)}
                title="Block user from matches"
              >
                Block User
              </button>
            </>
          )}
          {isSelf && (
            <Link to="/profile" className="btn btn-primary btn-sm">
              Edit My Profile →
            </Link>
          )}
        </div>
      </div>

      {/* Skills Taught & Wanted */}
      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h3 style={{ margin: '0 0 .75rem', fontSize: '1.05rem' }}>📚 Skills They Teach</h3>
        {profile.skillsOffered?.length > 0 ? (
          <div className="tag-list">
            {profile.skillsOffered.map((s, i) => {
              const endCount = getSkillEndorsementCount(s.skill)
              return (
                <span className="tag" key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem' }}>
                  <span>{s.skill}</span>
                  <small style={{ opacity: 0.7 }}>({s.level})</small>
                  {s.verified && (
                    <span className="badge-verified-inline" title="Skill officially verified by SkillSwap administrator">
                      ✓ Verified
                    </span>
                  )}
                  {endCount > 0 && (
                    <span className="endorsement-pill" title={`${endCount} peer endorsement(s) received`}>
                      ★ {endCount}
                    </span>
                  )}
                </span>
              )
            })}
          </div>
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '.88rem' }}>No skills listed</p>
        )}

        <h3 style={{ margin: '1.5rem 0 .75rem', fontSize: '1.05rem' }}>🎯 Skills They Want to Learn</h3>
        {profile.skillsWanted?.length > 0 ? (
          <div className="tag-list">
            {profile.skillsWanted.map((s, i) => (
              <span className="tag tag-wanted" key={i}>
                {s.skill} <small style={{ opacity: 0.7 }}>({s.priority} Priority)</small>
              </span>
            ))}
          </div>
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: '.88rem' }}>No learning skills specified</p>
        )}

        {/* Weekly Availability Calendar */}
        {profile.availabilitySlots?.length > 0 && (
          <div style={{ marginTop: '1.75rem' }}>
            <AvailabilityCalendar
              slots={profile.availabilitySlots}
              peerSlots={myProfile?.availabilitySlots || []}
              title={`${profile.name}'s Weekly Schedule`}
            />
          </div>
        )}
      </div>

      {/* Peer Skill Endorsements Section */}
      {endorsements.length > 0 && (
        <div className="card" style={{ marginTop: '1.5rem' }}>
          <div className="section-title-row">
            <h3 style={{ margin: 0, fontSize: '1.05rem' }}>
              🛡️ Verified Peer Endorsements ({endorsements.length})
            </h3>
            <span style={{ fontSize: '.82rem', color: '#10b981' }}>
              From verified barter swap completions
            </span>
          </div>

          <div className="card-list" style={{ marginTop: '1rem' }}>
            {endorsements.map(e => (
              <div key={e._id} className="endorsement-card" style={{ padding: '.85rem', background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px solid var(--border-color)', marginBottom: '.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                    <Avatar name={e.endorser?.name} size={30} />
                    <strong>{e.endorser?.name || 'Peer Student'}</strong>
                  </div>
                  <span className="badge badge-green" style={{ fontSize: '.75rem' }}>
                    ★ Endorsed: {e.skillName}
                  </span>
                </div>
                {e.comment && (
                  <p style={{ margin: '.45rem 0 .25rem', fontSize: '.84rem', color: 'var(--text-color)', fontStyle: 'italic' }}>
                    "{e.comment}"
                  </p>
                )}
                <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', marginTop: '.3rem' }}>
                  {new Date(e.createdAt).toLocaleDateString([], { dateStyle: 'medium' })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Completed Learning Achievements Section */}
      {achievements.length > 0 && (
        <div className="card" style={{ marginTop: '1.5rem' }}>
          <div className="section-title-row">
            <h3 style={{ margin: 0, fontSize: '1.05rem' }}>
              🏆 Completed Learning Roadmaps ({achievements.length})
            </h3>
            <span style={{ fontSize: '.82rem', color: '#10b981' }}>
              Mastered through peer mentorship
            </span>
          </div>
          <div className="tag-list" style={{ marginTop: '.75rem' }}>
            {achievements.map((a, i) => (
              <span className="tag" key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '.4rem' }}>
                <span>{a.skillName}</span>
                <span className="badge-verified-inline" style={{ background: 'rgba(16,185,129,0.2)' }}>
                  ✓ 100% Mastered
                </span>
                {a.instructor?.name && (
                  <small style={{ opacity: 0.75 }}>
                    (Coached by {a.instructor.name})
                  </small>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Reviews Section */}
      <div className="card" style={{ marginTop: '1.5rem' }}>
        <div className="section-title-row">
          <h3 style={{ margin: 0, fontSize: '1.05rem' }}>
            ⭐ Peer Reviews ({ratings.length})
          </h3>
          <span style={{ fontSize: '.85rem', color: 'var(--text-muted)' }}>
            Average: {profile.averageRating ? profile.averageRating.toFixed(1) : '0.0'} / 5.0
          </span>
        </div>

        <div style={{ marginTop: '1rem' }}>
          {ratings.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: '.88rem', fontStyle: 'italic', margin: '1rem 0' }}>
              No reviews yet. Complete a swap with {profile.name} to write the first review!
            </p>
          ) : (
            <div className="card-list">
              {ratings.map(r => (
                <div className="review-card" key={r._id}>
                  <div className="review-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                      <Avatar name={r.rater?.name} size={32} />
                      <strong>{r.rater?.name || 'Anonymous Peer'}</strong>
                    </div>
                    <Stars value={r.score} />
                  </div>
                  {r.comment && <p className="review-comment">{r.comment}</p>}
                  {r.swapRequest && (
                    <div className="review-swap-tag">
                      Exchanged: {r.swapRequest.offeredSkill} ⇄ {r.swapRequest.wantedSkill}
                    </div>
                  )}
                  <div style={{ fontSize: '.75rem', color: 'var(--text-muted)', marginTop: '.4rem' }}>
                    {new Date(r.createdAt).toLocaleDateString([], { dateStyle: 'medium' })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Propose Swap Modal */}
      {swapModalOpen && (
        <SwapModal
          match={{ user: profile, compatibilityScore: 0, compatibilityNote: 'Direct swap proposal' }}
          onClose={() => setSwapModalOpen(false)}
        />
      )}

      {/* Peer Skill Endorsement Modal */}
      {endorseModalOpen && (
        <EndorsementModal
          partner={profile}
          onClose={() => setEndorseModalOpen(false)}
          onSuccess={() => {
            loadData()
          }}
        />
      )}

      {/* In-App Block User Confirmation Modal (No window.confirm) */}
      {blockModalOpen && (
        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setBlockModalOpen(false) }}>
          <div className="modal" style={{ maxWidth: 420 }}>
            <div style={{ textAlign: 'center', padding: '0.5rem 0' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '.5rem' }}>🛡️</div>
              <h3>Block {profile.name}?</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '.9rem', margin: '.5rem 0 1.5rem', lineHeight: 1.5 }}>
                {profile.name} will no longer appear in your compatibility matches or searches, and won't be able to send you swap proposals.
              </p>
              <div style={{ display: 'flex', gap: '.5rem' }}>
                <button
                  className="btn btn-danger"
                  style={{ flex: 1 }}
                  onClick={handleConfirmBlock}
                  disabled={blocking}
                >
                  {blocking ? 'Blocking…' : 'Yes, Block User'}
                </button>
                <button
                  className="btn btn-muted"
                  onClick={() => setBlockModalOpen(false)}
                  disabled={blocking}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
