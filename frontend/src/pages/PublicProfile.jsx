import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import api from '../api/axios'
import Spinner from '../components/Spinner'
import Stars from '../components/Stars'

export default function PublicProfile() {
  const { id } = useParams()
  const [profile, setProfile] = useState(null)
  const [ratings, setRatings] = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  useEffect(() => {
    async function load() {
      try {
        const [profileRes, ratingsRes] = await Promise.all([
          api.get(`/profile/${id}`),
          api.get(`/rating/user/${id}`),
        ])
        setProfile(profileRes.data)
        setRatings(ratingsRes.data)
      } catch (err) {
        setError('User not found')
      } finally { setLoading(false) }
    }
    load()
  }, [id])

  if (loading) return <Spinner message="Loading profile…" />
  if (error)   return <div className="page"><div className="alert alert-error">⚠ {error}</div><Link to="/matches">← Back to Matches</Link></div>

  return (
    <div className="page" style={{ maxWidth: 650 }}>
      <Link to="/matches" style={{ fontSize: '.88rem' }}>← Back to Matches</Link>

      <h2 style={{ marginTop: '.75rem' }}>{profile.name}</h2>
      <Stars value={profile.averageRating} count={profile.totalRatings} />

      {profile.bio && <p style={{ margin: '1rem 0', color: 'var(--text-muted)' }}>{profile.bio}</p>}

      {/* Skills Offered */}
      <h3 style={{ marginTop: '1.5rem' }}>Skills They Teach</h3>
      {profile.skillsOffered?.length > 0 ? (
        <div className="tag-list">
          {profile.skillsOffered.map((s, i) => (
            <span className="tag" key={i}>
              {s.skill} <span style={{ fontSize: '.72rem', opacity: 0.7 }}>({s.level})</span>
            </span>
          ))}
        </div>
      ) : <p style={{ color: 'var(--text-muted)' }}>None listed</p>}

      {/* Skills Wanted */}
      <h3 style={{ marginTop: '1.25rem' }}>Skills They Want</h3>
      {profile.skillsWanted?.length > 0 ? (
        <div className="tag-list">
          {profile.skillsWanted.map((s, i) => (
            <span className="tag tag-wanted" key={i}>
              {s.skill} <span style={{ fontSize: '.72rem', opacity: 0.7 }}>({s.priority})</span>
            </span>
          ))}
        </div>
      ) : <p style={{ color: 'var(--text-muted)' }}>None listed</p>}

      {/* Availability */}
      {profile.availabilitySlots?.length > 0 && (
        <>
          <h3 style={{ marginTop: '1.25rem' }}>Availability</h3>
          <div className="tag-list">
            {profile.availabilitySlots.map((s, i) => (
              <span className="tag" key={i}>{s.day} {s.from}–{s.to}</span>
            ))}
          </div>
        </>
      )}

      {/* Member Since */}
      <p style={{ fontSize: '.82rem', color: 'var(--text-muted)', marginTop: '1.5rem' }}>
        Member since {new Date(profile.createdAt).toLocaleDateString()}
      </p>

      {/* Ratings / Reviews */}
      <h3 style={{ marginTop: '1.5rem' }}>Reviews ({ratings.length})</h3>
      {ratings.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>No reviews yet.</p>
      ) : (
        <div className="card-list">
          {ratings.map(r => (
            <div className="card" key={r._id} style={{ padding: '.75rem 1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>{r.rater?.name || 'Anonymous'}</strong>
                <Stars value={r.score} />
              </div>
              {r.comment && <p style={{ fontSize: '.85rem', margin: '.3rem 0 0', color: 'var(--text-muted)' }}>{r.comment}</p>}
              {r.swapRequest && (
                <p style={{ fontSize: '.75rem', color: 'var(--text-muted)', marginTop: '.25rem' }}>
                  Swap: {r.swapRequest.offeredSkill} ↔ {r.swapRequest.wantedSkill}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
