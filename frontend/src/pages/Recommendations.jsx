/**
 * Recommendations.jsx — Phase 4 + Phase 5 + Phase 6
 * "For You" page: ranked partner recommendations + skill suggestions + circular exchange discovery.
 * Uses existing JWT auth context, axios instance, and SkillSwap design system.
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import api from '../api/axios'
import { useAuth } from '../context/AuthContext'
import Spinner from '../components/Spinner'
import RecommendationCard from '../components/RecommendationCard'
import SkillSuggestionPill from '../components/SkillSuggestionPill'
import SwapModal from '../components/SwapModal'
import CircularCycleCard from '../components/CircularCycleCard'
import CircularProposalModal from '../components/CircularProposalModal'
import {
  IconSparkles,
  IconSwaps,
  IconRepeat,
  IconShield,
  IconDiscover,
  IconCheckCircle
} from '../components/Icons'

const TIER_FILTERS = [
  { label: 'All Recommendations', min: 0 },
  { label: 'Excellent Match (80+)', min: 80 },
  { label: 'Good Match (55+)', min: 55 },
  { label: 'Fair Match (30+)', min: 30 },
]

export default function Recommendations() {
  const [partners, setPartners] = useState([])
  const [skills, setSkills] = useState([])
  const [myProfile, setMyProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [meta, setMeta] = useState(null)
  const [swapTarget, setSwapTarget] = useState(null)
  const [tierFilter, setTierFilter] = useState(0)
  const [error, setError] = useState('')

  /* ── Mode toggle ── */
  const [mode, setMode] = useState('bilateral') // 'bilateral' | 'circular'

  /* ── Circular state ── */
  const [circularCycles, setCircularCycles] = useState([])
  const [circularLoading, setCircularLoading] = useState(false)
  const [circularError, setCircularError] = useState('')
  const [circularMeta, setCircularMeta] = useState(null)
  const [proposalTarget, setProposalTarget] = useState(null)

  const { user } = useAuth()
  const currentUserId = user?._id || user?.id

  /* ── Load bilateral data on mount ── */
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

  const filtered = partners.filter(r => (r.score || 0) >= tierFilter)

  if (loading) return <Spinner message="Computing weighted compatibility recommendations…" />

  return (
    <div className="page recommendations-page">
      {/* ─── Page Header ────────────────────────────────────────────────────── */}
      <div className="page-header-flex">
        <div>
          <div className="header-badge-row">
            <span className="recommendation-engine-badge">
              <IconSparkles size={14} /> Rule-Based Weighted Scoring
            </span>
          </div>
          <h1 className="page-title">Top Recommendations For You</h1>
          <p className="page-sub">
            Ranked by mutual skill overlap, verified expertise, peer ratings, and schedule alignment.
          </p>
        </div>
      </div>

      {error && <div className="alert alert-error">⚠️ {error}</div>}

      {/* ─── Mode Selector (Bilateral vs Circular) ─────────────────────────── */}
      <div className="recommendations-mode-bar">
        <button
          type="button"
          className={`mode-selector-btn ${mode === 'bilateral' ? 'mode-active' : ''}`}
          onClick={() => setMode('bilateral')}
        >
          <IconSwaps size={16} />
          <span>Bilateral Swaps (1:1)</span>
          <span className="mode-count-pill">{partners.length}</span>
        </button>

        <button
          type="button"
          className={`mode-selector-btn ${mode === 'circular' ? 'mode-active' : ''}`}
          onClick={() => setMode('circular')}
        >
          <IconRepeat size={16} />
          <span>3-Way Circular Exchanges</span>
          {circularCycles.length > 0 && (
            <span className="mode-count-pill pill-highlight">{circularCycles.length}</span>
          )}
        </button>
      </div>

      {/* ══════════════════════════════════════════════
          BILATERAL MODE
         ══════════════════════════════════════════════ */}
      {mode === 'bilateral' && (
        <>
          {/* Profile Completeness Nudges */}
          {meta?.profileCompleteness === 'empty' && (
            <div className="alert alert-info" style={{ marginTop: '1.25rem' }}>
              💡 {meta.message}{' '}
              <Link to="/profile" className="link-subtle" style={{ fontWeight: 700 }}>
                Complete your profile →
              </Link>
            </div>
          )}

          {meta?.profileCompleteness === 'wants_only' && (
            <div className="alert alert-info" style={{ marginTop: '1.25rem' }}>
              💡 You haven't added skills you can teach yet. Add them in your{' '}
              <Link to="/profile" className="link-subtle">profile</Link> to unlock reciprocal matching bonuses.
            </div>
          )}

          {meta?.profileCompleteness === 'offers_only' && (
            <div className="alert alert-info" style={{ marginTop: '1.25rem' }}>
              💡 Add skills you want to learn in your{' '}
              <Link to="/profile" className="link-subtle">profile</Link> to discover peers who can teach you.
            </div>
          )}

          {/* ─── Skill Suggestions ────────────────────────────────────────── */}
          {skills.length > 0 && (
            <div className="skills-suggestions-card card">
              <div className="section-title-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: '.45rem' }}>
                  <IconDiscover size={17} />
                  <h3 style={{ fontSize: '1rem', fontWeight: 700 }}>In-Demand Peer Skills</h3>
                </div>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Based on skills peers on SkillSwap teach
                </span>
              </div>
              <div className="skills-suggestion-pills-wrap">
                {skills.map((s, i) => (
                  <SkillSuggestionPill key={i} suggestion={s} />
                ))}
              </div>
            </div>
          )}

          {/* ─── Tier Filter Controls ─────────────────────────────────────── */}
          {partners.length > 0 && (
            <div className="rec-filters-container">
              <div className="rec-filters-header">
                <span className="rec-counter-text">
                  Showing <strong>{filtered.length}</strong> of <strong>{partners.length}</strong> ranked partner{partners.length !== 1 ? 's' : ''}
                </span>
              </div>

              <div className="filter-pills-row">
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

          {/* ─── Empty States ─────────────────────────────────────────────── */}
          {partners.length === 0 && !error && meta?.profileCompleteness !== 'empty' && (
            <div className="empty-card" style={{ marginTop: '2rem' }}>
              <IconDiscover size={40} />
              <h3>No recommendations yet</h3>
              <p style={{ maxWidth: 480, margin: '.5rem auto 1.5rem', color: 'var(--text-muted)' }}>
                Make sure your profile has skills you offer or want to learn so our scoring engine can find compatible peers.
              </p>
              <Link to="/profile" className="btn btn-primary shadow-glow">
                Update Profile →
              </Link>
            </div>
          )}

          {filtered.length === 0 && partners.length > 0 && (
            <div className="empty-card" style={{ marginTop: '1.5rem' }}>
              <IconDiscover size={36} />
              <h3>No peers found in this score tier</h3>
              <p style={{ color: 'var(--text-muted)' }}>
                Select "All Recommendations" to view all available matches.
              </p>
              <button
                className="btn btn-secondary"
                style={{ marginTop: '1rem' }}
                onClick={() => setTierFilter(0)}
              >
                Reset Tier Filter
              </button>
            </div>
          )}

          {/* ─── Partner Cards Grid ───────────────────────────────────────── */}
          {filtered.length > 0 && (
            <div className="card-grid" style={{ marginTop: '1.25rem' }}>
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

          {/* Swap modal */}
          {swapTarget && (
            <SwapModal
              match={swapTarget}
              onClose={() => setSwapTarget(null)}
              onSuccess={() => {
                setSwapTarget(null)
              }}
            />
          )}
        </>
      )}

      {/* ══════════════════════════════════════════════
          CIRCULAR MODE — 3-Way Closed Barter Cycles
         ══════════════════════════════════════════════ */}
      {mode === 'circular' && (
        <>
          {circularLoading && (
            <div style={{ marginTop: '2.5rem' }}>
              <Spinner message="Discovering 3-way circular exchanges…" />
            </div>
          )}

          {circularError && !circularLoading && (
            <div className="alert alert-error" style={{ marginTop: '1.5rem' }}>
              ⚠️ {circularError}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                style={{ marginLeft: '0.75rem' }}
                onClick={fetchCircular}
              >
                Retry Search
              </button>
            </div>
          )}

          {!circularLoading && !circularError && circularCycles.length === 0 && (
            <div className="empty-card" style={{ marginTop: '2rem' }}>
              <IconRepeat size={42} />
              <h3>No 3-way circular exchanges found right now</h3>
              <p style={{ maxWidth: 520, margin: '.5rem auto 1.5rem', color: 'var(--text-muted)' }}>
                Circular exchanges connect three peers in a closed barter loop (A teaches B, B teaches C, C teaches A). Add more skills to unlock multi-party discovery!
              </p>
              <Link to="/profile" className="btn btn-primary shadow-glow">
                Add More Skills →
              </Link>
            </div>
          )}

          {!circularLoading && !circularError && circularCycles.length > 0 && (
            <div style={{ marginTop: '1.5rem' }}>
              <div className="section-title-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                  <IconRepeat size={19} />
                  <h3 style={{ fontSize: '1.2rem', fontWeight: 800 }}>
                    Active 3-Way Barter Cycles ({circularCycles.length})
                  </h3>
                </div>
              </div>

              {circularMeta?.computedAt && (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  Cycle discovery generated at {new Date(circularMeta.computedAt).toLocaleString()}
                </p>
              )}

              <div className="card-grid" style={{ marginTop: '1.25rem' }}>
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
