/**
 * CircularCycleCard.jsx — Phase 6 / F-04 Stage 1
 * Displays a 3-way circular exchange cycle from GET /api/recommendations/circular.
 * Shows all three participants, directed skill-exchange legs,
 * backend-computed cycle score + breakdown, and a proposal action.
 */
import Avatar     from './Avatar'
import ScoreBadge from './ScoreBadge'
import Stars      from './Stars'

/**
 * Props:
 *   cycle         – cycle object from /api/recommendations/circular
 *   currentUserId – logged-in user's _id
 *   onPropose     – callback(cycle) to open CircularProposalModal
 */
export default function CircularCycleCard({ cycle, currentUserId, onPropose }) {
  const { legs, cycleScore, scoreBreakdown, reasons } = cycle

  const currentUserIdStr = currentUserId ? String(currentUserId) : ''

  // Find the leg where the current user is the teacher and the one where they learn.
  const teachingLeg = legs.find(l => String(l.teacher?._id || l.teacher) === currentUserIdStr)
  const learningLeg = legs.find(l => String(l.learner?._id || l.learner) === currentUserIdStr)

  // Collect unique participants in leg order for the visual triangle.
  const participants = legs.map(l => l.teacher)

  return (
    <div className="card" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* ── Header: Score badge ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
        <h4 style={{ margin: 0, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <span>🔄</span> 3-Way Circular Exchange
        </h4>
        <ScoreBadge score={cycleScore} />
      </div>

      {/* ── Triangular participant flow ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {legs.map((leg, i) => {
          const isMyTeaching = String(leg.teacher?._id || leg.teacher) === currentUserIdStr
          const isMyLearning = String(leg.learner?._id || leg.learner) === currentUserIdStr
          return (
            <div
              key={leg.legIndex ?? i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.6rem',
                padding: '0.6rem 0.75rem',
                borderRadius: '8px',
                background: isMyTeaching
                  ? '#ecfdf5'
                  : isMyLearning
                    ? '#eff6ff'
                    : '#f9fafb',
                border: (isMyTeaching || isMyLearning)
                  ? `1px solid ${isMyTeaching ? '#059669' : '#2563eb'}33`
                  : '1px solid var(--border)',
                flexWrap: 'wrap',
              }}
            >
              {/* Teacher */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
                <Avatar name={leg.teacher.name} size={32} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {leg.teacher.name}
                    {isMyTeaching && <span style={{ fontSize: '0.7rem', color: '#059669', marginLeft: '0.3rem' }}>(you)</span>}
                  </div>
                  <Stars value={leg.teacher.averageRating || 0} count={leg.teacher.totalRatings} />
                </div>
              </div>

              {/* Arrow + Skill */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                flex: '1 1 auto',
                justifyContent: 'center',
                minWidth: '120px',
              }}>
                <span style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>→</span>
                <span className="tag tag-highlight" style={{ fontSize: '0.78rem' }}>
                  {leg.skill}
                  <small style={{ opacity: 0.7, marginLeft: '0.25rem' }}>
                    ({leg.teacherLevel}{leg.learnerLevel ? ` → ${leg.learnerLevel}` : ''})
                  </small>
                </span>
                <span style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>→</span>
              </div>

              {/* Learner */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
                <Avatar name={leg.learner.name} size={32} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {leg.learner.name}
                    {isMyLearning && <span style={{ fontSize: '0.7rem', color: '#2563eb', marginLeft: '0.3rem' }}>(you)</span>}
                  </div>
                  <Stars value={leg.learner.averageRating || 0} count={leg.learner.totalRatings} />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Your role summary ── */}
      {teachingLeg && learningLeg && (
        <div
          style={{
            marginTop: '0.85rem',
            padding: '0.6rem 0.75rem',
            borderRadius: '8px',
            background: '#faf5ff',
            border: '1px solid #c084fc33',
            fontSize: '0.82rem',
          }}
        >
          <strong>Your role:</strong>{' '}
          Teach <span className="tag tag-highlight" style={{ fontSize: '0.75rem' }}>{teachingLeg.skill}</span>{' '}
          to {teachingLeg.learner.name} · Learn{' '}
          <span className="tag tag-highlight" style={{ fontSize: '0.75rem' }}>{learningLeg.skill}</span>{' '}
          from {learningLeg.teacher.name}
        </div>
      )}

      {/* ── Score breakdown (compact chips) ── */}
      {scoreBreakdown && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.3rem',
            marginTop: '0.7rem',
            fontSize: '0.72rem',
            color: 'var(--text-muted)',
          }}
        >
          {scoreBreakdown.levelCompatibility > 0 && (
            <span title="Level Compatibility (35%)" className="score-chip">
              🎯 {Math.round(scoreBreakdown.levelCompatibility)}pt level
            </span>
          )}
          {scoreBreakdown.exchangeReliability > 0 && (
            <span title="Exchange Reliability (35%)" className="score-chip">
              🤝 {Math.round(scoreBreakdown.exchangeReliability)}pt reliable
            </span>
          )}
          {scoreBreakdown.bayesianRating > 0 && (
            <span title="Bayesian Rating (15%)" className="score-chip">
              ⭐ {Math.round(scoreBreakdown.bayesianRating)}pt rating
            </span>
          )}
          {scoreBreakdown.skillVerification > 0 && (
            <span title="Skill Verification (15%)" className="score-chip">
              ✓ {Math.round(scoreBreakdown.skillVerification)}pt verified
            </span>
          )}
        </div>
      )}

      {/* ── Reasons (first 3) ── */}
      {reasons?.length > 0 && (
        <div style={{ marginTop: '0.6rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          {reasons.slice(0, 3).map((r, i) => (
            <div key={i} style={{ marginTop: i > 0 ? '0.2rem' : 0 }}>
              💡 {r}
            </div>
          ))}
        </div>
      )}

      {/* ── Propose button ── */}
      <div style={{ marginTop: 'auto', paddingTop: '1rem' }}>
        <button
          type="button"
          className="btn btn-primary btn-block shadow-glow"
          onClick={() => onPropose && onPropose(cycle)}
        >
          🚀 Propose 3-Way Exchange
        </button>
      </div>
    </div>
  )
}
