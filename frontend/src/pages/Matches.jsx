import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../api/axios'
import Spinner from '../components/Spinner'
import CompatBar from '../components/CompatBar'
import SwapModal from '../components/SwapModal'
import Stars from '../components/Stars'

export default function Matches() {
  const [matches, setMatches] = useState([])
  const [search,  setSearch]  = useState('')
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(true)
  const [swapTarget, setSwapTarget] = useState(null) // opens SwapModal
  const [error, setError] = useState('')

  // Load ranked matches
  useEffect(() => {
    async function load() {
      try {
        const { data } = await api.get('/match')
        setMatches(data.matches || [])
        if (data.message) setError(data.message)
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to load matches')
      } finally { setLoading(false) }
    }
    load()
  }, [])

  // Search
  async function handleSearch(e) {
    e.preventDefault()
    if (!search.trim()) { setResults(null); return }
    try {
      const { data } = await api.get(`/match/search?q=${encodeURIComponent(search.trim())}`)
      setResults(data)
    } catch (err) {
      setError('Search failed')
    }
  }

  if (loading) return <Spinner message="Finding matches…" />

  return (
    <div className="page">
      <h2>Skill Matches</h2>

      {/* Search */}
      <form onSubmit={handleSearch} style={{ display: 'flex', gap: '.5rem', marginBottom: '1.5rem' }}>
        <input className="form-input" placeholder="Search by name or skill…" value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1 }} />
        <button type="submit" className="btn btn-primary">Search</button>
        {results !== null && <button type="button" className="btn btn-muted" onClick={() => { setResults(null); setSearch('') }}>Clear</button>}
      </form>

      {error && <div className="alert alert-error">⚠ {error}</div>}

      {/* Search Results */}
      {results !== null ? (
        <>
          <h3>Search Results ({results.length})</h3>
          {results.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No users found.</p>}
          <div className="card-list">
            {results.map(u => (
              <div className="card" key={u._id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Link to={`/user/${u._id}`} className="card-name">{u.name}</Link>
                  <Stars value={u.averageRating} count={u.totalRatings} />
                </div>
                {u.bio && <p style={{ fontSize: '.85rem', color: 'var(--text-muted)', margin: '.4rem 0' }}>{u.bio}</p>}
                <p style={{ fontSize: '.85rem' }}>
                  <strong>Teaches:</strong> {(u.skillsOffered || []).map(s => s.skill).join(', ') || 'None'}
                </p>
                <button className="btn btn-accent btn-sm" style={{ marginTop: '.5rem' }} onClick={() => setSwapTarget({ user: u })}>
                  Request Swap
                </button>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          {/* Ranked Matches */}
          <h3>Your Top Matches ({matches.length})</h3>
          {matches.length === 0 && (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
              <p>No matches yet.</p>
              <p>Go to <Link to="/profile">Profile</Link> and add skills you want to learn!</p>
            </div>
          )}
          <div className="card-list">
            {matches.map(m => (
              <div className="card" key={m.user._id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Link to={`/user/${m.user._id}`} className="card-name">{m.user.name}</Link>
                  <Stars value={m.user.averageRating} count={m.user.totalRatings} />
                </div>
                {m.user.bio && <p style={{ fontSize: '.85rem', color: 'var(--text-muted)', margin: '.4rem 0' }}>{m.user.bio}</p>}
                <CompatBar score={m.compatibilityScore} note={m.compatibilityNote} />
                <p style={{ fontSize: '.85rem', marginTop: '.4rem' }}>
                  <strong>Teaches:</strong> {(m.user.skillsOffered || []).map(s => `${s.skill} (${s.level})`).join(', ')}
                </p>
                {m.user.skillsWanted?.length > 0 && (
                  <p style={{ fontSize: '.85rem' }}>
                    <strong>Wants:</strong> {m.user.skillsWanted.map(s => s.skill).join(', ')}
                  </p>
                )}
                {m.availabilityOverlap === true && <span className="badge badge-green">⏰ Schedule overlaps!</span>}
                {m.availabilityOverlap === false && <span className="badge badge-yellow">⏰ No schedule overlap</span>}
                <div style={{ marginTop: '.75rem' }}>
                  <button className="btn btn-accent btn-sm" onClick={() => setSwapTarget(m)}>Request Swap</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Swap Modal */}
      {swapTarget && <SwapModal match={swapTarget} onClose={() => setSwapTarget(null)} />}
    </div>
  )
}
