import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import api from '../api/axios'
import Spinner from '../components/Spinner'
import CompatBar from '../components/CompatBar'
import SwapModal from '../components/SwapModal'
import Stars from '../components/Stars'
import Avatar from '../components/Avatar'

const CATEGORY_FILTERS = ['All', 'High Match (70%+)', 'Schedule Match', 'Programming', 'Design', 'Music', 'Academic']

export default function Matches() {
  const [matches, setMatches] = useState([])
  const [search,  setSearch]  = useState('')
  const [selectedFilter, setSelectedFilter] = useState('All')
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(true)
  const [swapTarget, setSwapTarget] = useState(null)
  const [error, setError] = useState('')

  // Load ranked matches
  useEffect(() => {
    async function load() {
      try {
        const { data } = await api.get('/match')
        setMatches(data.matches || [])
        if (data.message && (!data.matches || data.matches.length === 0)) {
          setError(data.message)
        }
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to load matches')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // Handle Search
  async function handleSearch(e) {
    e.preventDefault()
    if (!search.trim()) {
      setResults(null)
      return
    }
    try {
      const { data } = await api.get(`/match/search?q=${encodeURIComponent(search.trim())}`)
      setResults(data)
    } catch (err) {
      setError('Search failed')
    }
  }

  // Filter matches based on category/score
  const filteredMatches = useMemo(() => {
    if (!matches) return []
    if (selectedFilter === 'All') return matches
    if (selectedFilter === 'High Match (70%+)') {
      return matches.filter(m => m.compatibilityScore >= 70)
    }
    if (selectedFilter === 'Schedule Match') {
      return matches.filter(m => m.availabilityOverlap === true)
    }
    // Filter by skill category in skillsOffered
    return matches.filter(m =>
      (m.user?.skillsOffered || []).some(s => s.category?.toLowerCase() === selectedFilter.toLowerCase())
    )
  }, [matches, selectedFilter])

  if (loading) return <Spinner message="Computing bidirectional compatibility matches…" />

  return (
    <div className="page">
      <div className="page-header-flex">
        <div>
          <h2 className="page-title">Peer Skill Matches</h2>
          <p className="page-sub">
            Ranked by mutual skill overlap (up to 60 pts forward + 40 pts reverse bidirectionality bonus).
          </p>
        </div>
      </div>

      {/* Search Bar */}
      <form onSubmit={handleSearch} className="search-form">
        <div className="search-input-wrapper">
          <span className="search-icon">🔍</span>
          <input
            className="form-input search-input"
            placeholder="Search by peer name, skill (e.g. Python, React), or topic…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="search-clear-btn"
              onClick={() => { setSearch(''); setResults(null) }}
            >
              ✕
            </button>
          )}
        </div>
        <button type="submit" className="btn btn-primary">
          Search
        </button>
      </form>

      {/* Category Pills (only show when not in custom search mode) */}
      {results === null && (
        <div className="filter-pills-row">
          {CATEGORY_FILTERS.map(f => (
            <button
              key={f}
              className={`filter-pill ${selectedFilter === f ? 'filter-pill-active' : ''}`}
              onClick={() => setSelectedFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
      )}

      {error && <div className="alert alert-info">💡 {error}</div>}

      {/* Custom Search Results View */}
      {results !== null ? (
        <div style={{ marginTop: '1.5rem' }}>
          <div className="section-title-row">
            <h3>Search Results ({results.length})</h3>
            <button
              className="btn btn-muted btn-sm"
              onClick={() => { setResults(null); setSearch('') }}
            >
              Back to Ranked Matches
            </button>
          </div>

          {results.length === 0 ? (
            <div className="empty-card">
              <div className="empty-icon">🔎</div>
              <h3>No users found</h3>
              <p>Try searching for a different skill name or keyword.</p>
            </div>
          ) : (
            <div className="card-grid">
              {results.map(u => (
                <div className="card peer-card" key={u._id}>
                  <div className="peer-card-header">
                    <Avatar name={u.name} size={48} />
                    <div style={{ flex: 1 }}>
                      <Link to={`/user/${u._id}`} className="card-name">
                        {u.name}
                      </Link>
                      <div>
                        <Stars value={u.averageRating || 0} count={u.totalRatings} />
                      </div>
                    </div>
                  </div>

                  {u.bio && <p className="peer-bio">{u.bio}</p>}

                  <div className="peer-skills-section">
                    <div className="skills-group">
                      <span className="skills-label">Teaches:</span>
                      <div className="tag-list">
                        {(u.skillsOffered || []).map((s, idx) => (
                          <span className="tag" key={idx}>
                            {s.skill} <small style={{ opacity: 0.7 }}>({s.level})</small>
                          </span>
                        ))}
                      </div>
                    </div>

                    {u.skillsWanted?.length > 0 && (
                      <div className="skills-group" style={{ marginTop: '.5rem' }}>
                        <span className="skills-label">Wants:</span>
                        <div className="tag-list">
                          {u.skillsWanted.map((s, idx) => (
                            <span className="tag tag-wanted" key={idx}>
                              {s.skill}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="peer-card-footer">
                    <button
                      className="btn btn-primary btn-sm btn-block"
                      onClick={() => setSwapTarget({ user: u })}
                    >
                      Propose Swap
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        /* Ranked Matches Grid */
        <div style={{ marginTop: '1rem' }}>
          {filteredMatches.length === 0 ? (
            <div className="empty-card">
              <div className="empty-icon">🎯</div>
              <h3>No matches in this category</h3>
              <p style={{ maxWidth: 460, margin: '.5rem auto 1.5rem', color: 'var(--text-muted)' }}>
                {matches.length === 0
                  ? 'Add skills you want to learn in your profile to let our matching algorithm find peers for you.'
                  : 'Try selecting "All" or switching filters to see other compatible peers.'}
              </p>
              {matches.length === 0 && (
                <Link to="/profile" className="btn btn-primary shadow-glow">
                  Add Skills to Profile →
                </Link>
              )}
            </div>
          ) : (
            <div className="card-grid">
              {filteredMatches.map(m => (
                <div className="card peer-card" key={m.user._id}>
                  <div className="peer-card-header">
                    <Avatar name={m.user.name} size={48} />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Link to={`/user/${m.user._id}`} className="card-name">
                          {m.user.name}
                        </Link>
                        {m.availabilityOverlap === true && (
                          <span className="badge badge-green" title="Your free hours align">
                            ⏰ Available
                          </span>
                        )}
                      </div>
                      <Stars value={m.user.averageRating || 0} count={m.user.totalRatings} />
                    </div>
                  </div>

                  {m.user.bio && <p className="peer-bio">{m.user.bio}</p>}

                  {/* Compatibility Progress Bar */}
                  <CompatBar score={m.compatibilityScore} note={m.compatibilityNote} />

                  {/* Skills tags */}
                  <div className="peer-skills-section">
                    <div className="skills-group">
                      <span className="skills-label">Teaches:</span>
                      <div className="tag-list">
                        {(m.user.skillsOffered || []).map((s, idx) => (
                          <span className="tag" key={idx}>
                            {s.skill} <small style={{ opacity: 0.7 }}>({s.level})</small>
                          </span>
                        ))}
                      </div>
                    </div>

                    {m.user.skillsWanted?.length > 0 && (
                      <div className="skills-group" style={{ marginTop: '.5rem' }}>
                        <span className="skills-label">Wants:</span>
                        <div className="tag-list">
                          {m.user.skillsWanted.map((s, idx) => (
                            <span className="tag tag-wanted" key={idx}>
                              {s.skill}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="peer-card-footer">
                    <button
                      className="btn btn-primary btn-block shadow-glow"
                      onClick={() => setSwapTarget(m)}
                    >
                      ⚡ Request Swap
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Swap Modal */}
      {swapTarget && (
        <SwapModal
          match={swapTarget}
          onClose={() => setSwapTarget(null)}
        />
      )}
    </div>
  )
}
