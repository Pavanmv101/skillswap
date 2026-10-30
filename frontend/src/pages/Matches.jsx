import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import api from '../api/axios'
import Spinner from '../components/Spinner'
import CompatBar from '../components/CompatBar'
import SwapModal from '../components/SwapModal'
import Stars from '../components/Stars'
import Avatar from '../components/Avatar'
import AvailabilityCalendar from '../components/AvailabilityCalendar'

const CATEGORY_FILTERS = [
  'All',
  'High Match (70%+)',
  'Schedule Match',
  'Programming',
  'Design',
  'Music',
  'Academic',
  'Language',
  'Business',
]

export default function Matches() {
  const [matches, setMatches] = useState([])
  const [myProfile, setMyProfile] = useState(null)
  const [search, setSearch] = useState('')
  const [selectedFilter, setSelectedFilter] = useState('All')
  const [expandedCalendarId, setExpandedCalendarId] = useState(null)

  // Network wide search results fallback
  const [globalSearchActive, setGlobalSearchActive] = useState(false)
  const [globalResults, setGlobalResults] = useState([])
  const [globalLoading, setGlobalLoading] = useState(false)

  const [loading, setLoading] = useState(true)
  const [swapTarget, setSwapTarget] = useState(null)
  const [error, setError] = useState('')

  // Load ranked matches and current user profile for mutual availability
  useEffect(() => {
    async function load() {
      try {
        const [matchRes, profileRes] = await Promise.all([
          api.get('/match'),
          api.get('/profile'),
        ])
        setMatches(matchRes.data.matches || [])
        setMyProfile(profileRes.data)
        if (matchRes.data.message && (!matchRes.data.matches || matchRes.data.matches.length === 0)) {
          setError(matchRes.data.message)
        }
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to load matches')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // Combined client-side filtering: search query + category filter
  const filteredMatches = useMemo(() => {
    if (!matches) return []
    const q = search.trim().toLowerCase()

    return matches.filter(m => {
      // 1. Text Search: matches user name, skills offered, skills wanted, or bio
      if (q) {
        const matchName = m.user?.name?.toLowerCase().includes(q)
        const matchBio  = m.user?.bio?.toLowerCase().includes(q)
        const matchOffered = (m.user?.skillsOffered || []).some(s => s.skill.toLowerCase().includes(q))
        const matchWanted  = (m.user?.skillsWanted || []).some(s => s.skill.toLowerCase().includes(q))

        if (!matchName && !matchBio && !matchOffered && !matchWanted) {
          return false
        }
      }

      // 2. Category Filter
      if (selectedFilter === 'All') return true
      if (selectedFilter === 'High Match (70%+)') {
        return m.compatibilityScore >= 70
      }
      if (selectedFilter === 'Schedule Match') {
        return m.availabilityOverlap === true
      }

      // Match skill category in skillsOffered
      return (m.user?.skillsOffered || []).some(
        s => s.category?.toLowerCase() === selectedFilter.toLowerCase()
      )
    })
  }, [matches, search, selectedFilter])

  // Clear all active filters
  function handleClearFilters() {
    setSearch('')
    setSelectedFilter('All')
    setGlobalSearchActive(false)
    setGlobalResults([])
  }

  // Optional: Global network-wide search across unranked students
  async function handleGlobalSearch(e) {
    if (e) e.preventDefault()
    if (!search.trim()) return

    setGlobalLoading(true)
    setGlobalSearchActive(true)
    try {
      const { data } = await api.get(`/match/search?q=${encodeURIComponent(search.trim())}`)
      setGlobalResults(data || [])
    } catch (err) {
      setError('Global search failed')
    } finally {
      setGlobalLoading(false)
    }
  }

  const isFiltering = search.trim() !== '' || selectedFilter !== 'All'

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

      {/* Search Bar & Filter Controls */}
      <div className="search-form-container">
        <form onSubmit={e => e.preventDefault()} className="search-form">
          <div className="search-input-wrapper">
            <span className="search-icon">🔍</span>
            <input
              className="form-input search-input"
              placeholder="Search by student name, skill offered, skill wanted (e.g. React, Python, Figma)…"
              value={search}
              onChange={e => {
                setSearch(e.target.value)
                if (globalSearchActive) setGlobalSearchActive(false)
              }}
            />
            {search && (
              <button
                type="button"
                className="search-clear-btn"
                onClick={() => setSearch('')}
                title="Clear search"
              >
                ✕
              </button>
            )}
          </div>
          {isFiltering && (
            <button
              type="button"
              className="btn btn-muted btn-sm"
              onClick={handleClearFilters}
            >
              Reset Filters
            </button>
          )}
        </form>

        {/* Category Filter Pills */}
        <div className="filter-pills-row" style={{ marginTop: '0.75rem' }}>
          {CATEGORY_FILTERS.map(f => (
            <button
              key={f}
              type="button"
              className={`filter-pill ${selectedFilter === f ? 'filter-pill-active' : ''}`}
              onClick={() => {
                setSelectedFilter(f)
                if (globalSearchActive) setGlobalSearchActive(false)
              }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Result Status Bar */}
      <div className="matches-status-strip">
        <div className="status-strip-left">
          <span className="result-count-badge">
            ⚡ {filteredMatches.length} Compatible Peer{filteredMatches.length !== 1 ? 's' : ''} Found
          </span>
          {isFiltering && (
            <span className="active-filter-tag">
              Filter: <strong>{selectedFilter}</strong> {search && `• Keyword: "${search}"`}
            </span>
          )}
        </div>
        {search.trim() && !globalSearchActive && (
          <button
            type="button"
            className="link-subtle"
            style={{ background: 'none', border: 'none', cursor: 'pointer' }}
            onClick={handleGlobalSearch}
          >
            🔍 Search all registered students for "{search}" →
          </button>
        )}
      </div>

      {error && <div className="alert alert-info">💡 {error}</div>}

      {/* Global Network Results Mode (if triggered) */}
      {globalSearchActive ? (
        <div style={{ marginTop: '1.25rem' }}>
          <div className="section-title-row">
            <h3>Global Network Search: "{search}" ({globalResults.length})</h3>
            <button className="btn btn-muted btn-sm" onClick={() => setGlobalSearchActive(false)}>
              Back to Compatibility Matches
            </button>
          </div>

          {globalLoading ? (
            <Spinner message="Searching student directory…" />
          ) : globalResults.length === 0 ? (
            <div className="empty-card">
              <div className="empty-icon">🔎</div>
              <h3>No students found for "{search}"</h3>
              <p>Try searching for a different skill or reset your filters.</p>
              <button className="btn btn-primary btn-sm" onClick={handleClearFilters} style={{ marginTop: '1rem' }}>
                Reset Filters
              </button>
            </div>
          ) : (
            <div className="card-grid" style={{ marginTop: '1rem' }}>
              {globalResults.map(u => (
                <div className="card peer-card" key={u._id}>
                  <div className="peer-card-header">
                    <Avatar name={u.name} size={48} />
                    <div style={{ flex: 1 }}>
                      <Link to={`/user/${u._id}`} className="card-name">{u.name}</Link>
                      <Stars value={u.averageRating || 0} count={u.totalRatings} />
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
                            {s.verified && <span className="badge-verified-inline" title="Skill Verified">✓</span>}
                          </span>
                        ))}
                      </div>
                    </div>
                    {u.skillsWanted?.length > 0 && (
                      <div className="skills-group" style={{ marginTop: '.5rem' }}>
                        <span className="skills-label">Wants:</span>
                        <div className="tag-list">
                          {u.skillsWanted.map((s, idx) => (
                            <span className="tag tag-wanted" key={idx}>{s.skill}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="peer-card-footer">
                    <button
                      className="btn btn-primary btn-sm btn-block shadow-glow"
                      onClick={() => setSwapTarget({ user: u, compatibilityScore: 0, compatibilityNote: 'Direct swap request' })}
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
              <div className="empty-icon">{isFiltering ? '🔍' : '🎯'}</div>
              <h3>{isFiltering ? 'No matches fit this filter' : 'No matches yet'}</h3>
              <p style={{ maxWidth: 480, margin: '.5rem auto 1.5rem', color: 'var(--text-muted)' }}>
                {isFiltering
                  ? `No peers found matching "${search}" in the "${selectedFilter}" category. Try resetting filters or searching the wider network.`
                  : matches.length === 0
                  ? 'Add skills you want to learn in your profile to let our matching algorithm find peers for you.'
                  : 'Try selecting "All" or switching filters to see other compatible peers.'}
              </p>
              <div style={{ display: 'flex', gap: '.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
                {isFiltering && (
                  <button className="btn btn-muted" onClick={handleClearFilters}>
                    Clear All Filters
                  </button>
                )}
                {search.trim() && (
                  <button className="btn btn-primary" onClick={handleGlobalSearch}>
                    Search Entire Network for "{search}"
                  </button>
                )}
                {!isFiltering && matches.length === 0 && (
                  <Link to="/profile" className="btn btn-primary shadow-glow">
                    Add Skills to Profile →
                  </Link>
                )}
              </div>
            </div>
          ) : (
            <div className="card-grid">
              {filteredMatches.map(m => {
                const isCalendarOpen = expandedCalendarId === m.user._id
                return (
                  <div className="card peer-card" key={m.user._id}>
                    <div className="peer-card-header">
                      <Avatar name={m.user.name} size={48} />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Link to={`/user/${m.user._id}`} className="card-name">
                            {m.user.name}
                          </Link>
                          {m.availabilityOverlap === true && (
                            <span
                              className="badge badge-green"
                              style={{ cursor: 'pointer' }}
                              onClick={() => setExpandedCalendarId(isCalendarOpen ? null : m.user._id)}
                              title="Click to view weekly schedule alignment"
                            >
                              ⏰ Schedule Aligned
                            </span>
                          )}
                        </div>
                        <Stars value={m.user.averageRating || 0} count={m.user.totalRatings} />
                      </div>
                    </div>

                    {m.user.bio && <p className="peer-bio">{m.user.bio}</p>}

                    {/* Compatibility Progress Bar */}
                    <CompatBar score={m.compatibilityScore} note={m.compatibilityNote} />

                    {/* Skills Tags */}
                    <div className="peer-skills-section">
                      <div className="skills-group">
                        <span className="skills-label">Teaches:</span>
                        <div className="tag-list">
                          {(m.user.skillsOffered || []).map((s, idx) => (
                            <span className="tag" key={idx}>
                              {s.skill} <small style={{ opacity: 0.7 }}>({s.level})</small>
                              {s.verified && (
                                <span className="badge-verified-inline" title="Skill Verified by SkillSwap">✓ Verified</span>
                              )}
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

                    {/* Interactive Calendar Accordion */}
                    {isCalendarOpen && (
                      <div style={{ marginTop: '.85rem' }}>
                        <AvailabilityCalendar
                          slots={m.user.availabilitySlots || []}
                          peerSlots={myProfile?.availabilitySlots || []}
                          title={`${m.user.name}'s Free Hours`}
                        />
                      </div>
                    )}

                    <div className="peer-card-footer" style={{ display: 'flex', gap: '.5rem' }}>
                      <button
                        type="button"
                        className="btn btn-muted btn-sm"
                        onClick={() => setExpandedCalendarId(isCalendarOpen ? null : m.user._id)}
                        title="View availability calendar"
                      >
                        {isCalendarOpen ? 'Hide Hours' : '📅 Hours'}
                      </button>
                      <button
                        className="btn btn-primary btn-block shadow-glow"
                        onClick={() => setSwapTarget(m)}
                      >
                        ⚡ Request Swap
                      </button>
                    </div>
                  </div>
                )
              })}
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
