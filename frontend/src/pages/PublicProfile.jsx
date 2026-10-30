import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import api from '../api/axios'
import Spinner from '../components/Spinner'
import Stars from '../components/Stars'
import Avatar from '../components/Avatar'
import SwapModal from '../components/SwapModal'
import AvailabilityCalendar from '../components/AvailabilityCalendar'
import { useToast } from '../context/ToastContext'

export default function PublicProfile() {
  const { id } = useParams()
  const { addToast } = useToast()
  const [profile, setProfile] = useState(null)
  const [myProfile, setMyProfile] = useState(null)
  const [ratings, setRatings] = useState([])
  const [loading, setLoading] = useState(true)
  const [swapModalOpen, setSwapModalOpen] = useState(false)
  const [blockModalOpen, setBlockModalOpen] = useState(false)
  const [blocking, setBlocking] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const [profileRes, ratingsRes, myProfileRes] = await Promise.all([
          api.get(`/profile/${id}`),
          api.get(`/rating/user/${id}`),
          api.get('/profile').catch(() => ({ data: null })),
        ])
        setProfile(profileRes.data)
        setRatings(ratingsRes.data || [])
        setMyProfile(myProfileRes?.data)
      } catch (err) {
        setError('User profile not found')
      } finally {
        setLoading(false)
      }
    }
    load()
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

  if (loading) return <Spinner message="Loading user profile…" />
  if (error) {
    return (
      <div className="page" style={{ maxWidth: 650 }}>
        <div className="alert alert-error">⚠ {error}</div>
        <Link to="/matches" className="btn btn-muted">← Back to Matches</Link>
      </div>
    )
  }

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
            </div>
            {profile.bio && <p className="public-bio">{profile.bio}</p>}
          </div>
        </div>

        <div className="public-actions-bar">
          <button
            className="btn btn-primary btn-md shadow-glow"
            onClick={() => setSwapModalOpen(true)}
          >
            ⚡ Propose Skill Swap
          </button>
          <button
            className="btn btn-muted btn-sm"
            onClick={() => setBlockModalOpen(true)}
            title="Block user from matches"
          >
            Block User
          </button>
        </div>
      </div>

      {/* Skills Taught & Wanted */}
      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h3 style={{ margin: '0 0 .75rem', fontSize: '1.05rem' }}>📚 Skills They Teach</h3>
        {profile.skillsOffered?.length > 0 ? (
          <div className="tag-list">
            {profile.skillsOffered.map((s, i) => (
              <span className="tag" key={i}>
                {s.skill} <small style={{ opacity: 0.7 }}>({s.level})</small>
              </span>
            ))}
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

      {/* Reviews Section */}
      <div className="card" style={{ marginTop: '1.5rem' }}>
        <div className="section-title-row">
          <h3 style={{ margin: 0, fontSize: '1.05rem' }}>
            ⭐ Peer Reviews & Endorsements ({ratings.length})
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
