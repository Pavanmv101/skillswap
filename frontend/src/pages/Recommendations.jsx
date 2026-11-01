/**
 * Recommendations.jsx — Phase 5 + Phase 6 F-04 Stage 1
 * "For You" page: ranked partner recommendations + skill suggestions + circular exchange discovery.
 * Uses existing JWT auth context, axios instance, and SkillSwap design system.
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import api                    from '../api/axios'
import { useAuth }            from '../context/AuthContext'
import Spinner                from '../components/Spinner'
import RecommendationCard     from '../components/RecommendationCard'
import SkillSuggestionPill    from '../components/SkillSuggestionPill'
import SwapModal              from '../components/SwapModal'
import CircularCycleCard      from '../components/CircularCycleCard'
import CircularProposalModal  from '../components/CircularProposalModal'
import { Link }               from 'react-router-dom'

const TIER_FILTERS = [
  { label: 'All',         min: 0   },
  { label: '🟢 Excellent (80+)',  min: 80  },
  { label: '🔵 Good (55+)',       min: 55  },
  { label: '🟡 Fair (30+)',       min: 30  },
]

export default function Recommendations() {
  /* ── Bilateral state (unchanged from Phase 5) ── */
  const [partners,    setPartners]    = useState([])
  const [skills,      setSkills]      = useState([])
  const [myProfile,   setMyProfile]   = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [meta,        setMeta]        = useState(null)
  const [swapTarget,  setSwapTarget]  = useState(null)
  const [tierFilter,  setTierFilter]  = useState(0)
  const [error,       setError]       = useState('')

  /* ── Mode toggle ── */
  const [mode, setMode] = useState('bilateral') // 'bilateral' | 'circular'

  /* ── Circular state ── */
  const [circularCycles,  setCircularCycles]  = useState([])
  const [circularLoading, setCircularLoading] = useState(false)
  const [circularError,   setCircularError]   = useState('')
  const [circularMeta,    setCircularMeta]    = useState(null)
  const [proposalTarget,  setProposalTarget]  = useState(null)

  const { user } = useAuth()
  const currentUserId = user?._id || user?.id

  /* ── Load bilateral data on mount (unchanged) ── */
  useEffect(() => {
    async function load() {
      try {
        const [partnerRes, skillRes, profileRes] = await Promise.all([
          api.get('/recommendations/partners'),
          api.get('/recommendations/skills'),
          api.get('/profile'),
        ])
        setPartners(partnerRes.data.recommendations || [])
        setMeta(partnerRes.data.meta || null)
        setSkills(skillRes.data.suggestedSkills || [])
        setMyProfile(profileRes.data)
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to load recommendations')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const isMountedRef = useRef(true)

  useEffect(() => {
    isMountedRef.current = true
    return () => { isMountedRef.current = false }
  }, [])

  /* ── Lazy-load circular cycles when mode switches ── */
  const fetchCircular = useCallback(async () => {
    setCircularLoading(true)
    setCircularError('')
    try {
      const res = await api.get('/recommendations/circular')
      if (!isMountedRef.current) return
      setCircularCycles(res.data.cycles || [])
      setCircularMeta(res.data.meta || null)
    } catch (err) {
      if (!isMountedRef.current) return
      setCircularError(err.response?.data?.message || 'Failed to load circular exchanges')
    } finally {
      if (isMountedRef.current) {
        setCircularLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    if (mode === 'circular') {
      fetchCircular()
    }
  }, [mode, fetchCircular])

  const filtered = partners.filter(r => r.score >= tierFilter)

  if (loading) return <Spinner message="Computing personalised recommendations…" />

  return (
    <div className="page">
      {/* Page header */}
      <div className="page-header-flex">
        <div>
          <h2 className="page-title">✨ For You</h2>
          <p className="page-sub">
            Personalised partners ranked by skill overlap, verified expertise, ratings, and schedule alignment.
          </p>
        </div>
      </div>

      {error && <div className="alert alert-error">⚠️ {error}</div>}

      {/* ── Mode toggle pills ── */}
      <div className="filter-pills-row" style={{ marginTop: '1rem' }}>
        <button
          type="button"
          className={`filter-pill ${mode === 'bilateral' ? 'filter-pill-active' : ''}`}
          onClick={() => setMode('bilateral')}
        >
          🤝 Bilateral Swaps
        </button>
        <button
          type="button"
          className={`filter-pill ${mode === 'circular' ? 'filter-pill-active' : ''}`}
          onClick={() => setMode('circular')}
        >
          🔄 3-Way Exchanges
        </button>
      </div>

      {/* ══════════════════════════════════════════════
          BILATERAL MODE — unchanged Phase 5 content
         ══════════════════════════════════════════════ */}
      {mode === 'bilateral' && (
        <>
          {/* Completeness nudge */}
          {meta?.profileCompleteness === 'empty' && (
            <div className="alert alert-info" style={{ marginTop: '1rem' }}>
              💡 {meta.message}{' '}
              <Link to="/profile" className="link-subtle" style={{ fontWeight: 600 }}>
                Complete your profile →
              </Link>
            </div>
          )}

          {meta?.profileCompleteness === 'wants_only' && (
            <div className="alert alert-info" style={{ marginTop: '1rem' }}>
              💡 You haven't added skills you can teach yet. Add them in your{' '}
              <Link to="/profile" className="link-subtle">profile</Link> to unlock the reverse-match bonus.
            </div>
          )}

          {meta?.profileCompleteness === 'offers_only' && (
            <div className="alert alert-info" style={{ marginTop: '1rem' }}>
              💡 Add skills you want to learn in your{' '}
              <Link to="/profile" className="link-subtle">profile</Link> to discover partners who can teach you.
            </div>
          )}

          {/* ── Skill Suggestions ── */}
          {skills.length > 0 && (
            <div style={{ marginTop: '2rem' }}>
              <div className="section-title-row">
                <h3>🎓 Skills to Consider Learning</h3>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Based on what peers on SkillSwap teach
                </span>
              </div>
              <div
                style={{
                  display:    'flex',
                  flexWrap:   'wrap',
                  gap:        '0.5rem',
                  marginTop:  '0.75rem',
                }}
              >
                {skills.map((s, i) => (
                  <SkillSuggestionPill key={i} suggestion={s} />
                ))}
              </div>
            </div>
          )}

          {/* ── Tier filter pills ── */}
          {partners.length > 0 && (
            <div style={{ marginTop: '2rem' }}>
              <div className="section-title-row">
                <h3>
                  🤝 Recommended Partners
                  <span
                    style={{
                      marginLeft:  '0.5rem',
                      fontSize:    '0.82rem',
                      fontWeight:  400,
                      color:       'var(--text-muted)',
                    }}
                  >
                    ({filtered.length} of {partners.length})
                  </span>
                </h3>
              </div>

              <div className="filter-pills-row" style={{ marginTop: '0.75rem' }}>
                {TIER_FILTERS.map(f => (
                  <button
                    key={f.label}
                    type="button"
                    className={`filter-pill ${tierFilter === f.min ? 'filter-pill-active' : ''}`}
                    onClick={() => setTierFilter(f.min)}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── Partner cards grid ── */}
          {partners.length === 0 && !error && meta?.profileCompleteness !== 'empty' && (
            <div className="empty-card" style={{ marginTop: '2rem' }}>
              <div className="empty-icon">🔍</div>
              <h3>No recommendations yet</h3>
              <p style={{ maxWidth: 480, margin: '.5rem auto 1.5rem', color: 'var(--text-muted)' }}>
                Make sure your profile has skills you offer or want to learn so our engine can find compatible peers.
              </p>
              <Link to="/profile" className="btn btn-primary shadow-glow">
                Update Profile →
              </Link>
            </div>
          )}

          {filtered.length === 0 && partners.length > 0 && (
            <div className="empty-card" style={{ marginTop: '1.5rem' }}>
              <div className="empty-icon">🔍</div>
              <h3>No matches at this tier</h3>
              <p style={{ color: 'var(--text-muted)' }}>
                Try lowering the filter to see more partners.
              </p>
              <button
                className="btn btn-muted"
                style={{ marginTop: '1rem' }}
                onClick={() => setTierFilter(0)}
              >
                Show All
              </button>
            </div>
          )}

          {filtered.length > 0 && (
            <div className="card-grid" style={{ marginTop: '1rem' }}>
              {filtered.map(rec => (
                <RecommendationCard
                  key={rec.user._id}
                  rec={rec}
                  mySlots={myProfile?.availabilitySlots || []}
                  onRequestSwap={setSwapTarget}
                />
              ))}
            </div>
          )}

          {/* Swap modal — reuses existing component */}
          {swapTarget && (
            <SwapModal
              match={swapTarget}
              onClose={() => setSwapTarget(null)}
            />
          )}
        </>
      )}

      {/* ══════════════════════════════════════════════
          CIRCULAR MODE — Phase 6 F-04 Stage 1
         ══════════════════════════════════════════════ */}
      {mode === 'circular' && (
        <>
          {/* Loading */}
          {circularLoading && (
            <div style={{ marginTop: '2rem' }}>
              <Spinner message="Discovering 3-way circular exchanges…" />
            </div>
          )}

          {/* Error with retry */}
          {circularError && !circularLoading && (
            <div className="alert alert-error" style={{ marginTop: '1.5rem' }}>
              ⚠️ {circularError}
              <button
                type="button"
                className="btn btn-muted btn-sm"
                style={{ marginLeft: '0.75rem' }}
                onClick={fetchCircular}
              >
                🔄 Retry
              </button>
            </div>
          )}

          {/* Empty state */}
          {!circularLoading && !circularError && circularCycles.length === 0 && (
            <div className="empty-card" style={{ marginTop: '2rem' }}>
              <div className="empty-icon">🔄</div>
              <h3>No 3-way circular exchanges found</h3>
              <p style={{ maxWidth: 480, margin: '.5rem auto 1.5rem', color: 'var(--text-muted)' }}>
                Add more skills to your profile to unlock multi-way barter opportunities.
                Circular exchanges connect three people in a chain so everyone teaches and learns!
              </p>
              <Link to="/profile" className="btn btn-primary shadow-glow">
                Update Skills →
              </Link>
            </div>
          )}

          {/* Cycle cards */}
          {!circularLoading && !circularError && circularCycles.length > 0 && (
            <div style={{ marginTop: '1.5rem' }}>
              <div className="section-title-row">
                <h3>
                  🔄 Circular Exchanges
                  <span
                    style={{
                      marginLeft:  '0.5rem',
                      fontSize:    '0.82rem',
                      fontWeight:  400,
                      color:       'var(--text-muted)',
                    }}
                  >
                    ({circularCycles.length} found)
                  </span>
                </h3>
              </div>

              {circularMeta?.computedAt && (
                <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  Computed {new Date(circularMeta.computedAt).toLocaleString()}
                </p>
              )}

              <div className="card-grid" style={{ marginTop: '1rem' }}>
                {circularCycles.map((cycle, i) => (
                  <CircularCycleCard
                    key={cycle.canonicalCycleHash || i}
                    cycle={cycle}
                    currentUserId={currentUserId}
                    onPropose={setProposalTarget}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Circular proposal modal */}
          {proposalTarget && (
            <CircularProposalModal
              cycle={proposalTarget}
              onClose={() => setProposalTarget(null)}
              onSuccess={fetchCircular}
            />
          )}
        </>
      )}
    </div>
  )
}
