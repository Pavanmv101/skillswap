/**
 * RecommendationCard.jsx — Phase 5
 * Full partner recommendation card with score badge, reasons,
 * matched skill tags, availability badge, and Request Swap button.
 * Reuses: Avatar, Stars, CompatBar, AvailabilityCalendar, ScoreBadge, RecommendationReasons
 */
import { useState } from 'react'
import { Link }     from 'react-router-dom'
import Avatar                  from './Avatar'
import Stars                   from './Stars'
import CompatBar               from './CompatBar'
import ScoreBadge              from './ScoreBadge'
import RecommendationReasons   from './RecommendationReasons'
import AvailabilityCalendar    from './AvailabilityCalendar'

export default function RecommendationCard({ rec, mySlots = [], onRequestSwap }) {
  const [calOpen, setCalOpen] = useState(false)
  const { user, score, reasons, matchedWants, matchedOffers, alreadyConnected, availabilityOverlap, scoreBreakdown } = rec

  const compatNote = [
    matchedWants?.length  > 0 ? `They offer: ${matchedWants.join(', ')}` : '',
    matchedOffers?.length > 0 ? `You offer: ${matchedOffers.join(', ')}` : '',
  ].filter(Boolean).join('. ') || 'Skill compatibility detected.'

  return (
    <div className="card peer-card">
      {/* Header row */}
      <div className="peer-card-header" style={{ alignItems: 'flex-start' }}>
        <Avatar name={user.name} size={48} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', flexWrap: 'wrap' }}>
            <Link
              to={`/user/${user._id}`}
              className="card-name"
              style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 'calc(100% - 110px)' }}
            >
              {user.name}
            </Link>
            <ScoreBadge score={score} />
          </div>
          <Stars value={user.averageRating || 0} count={user.totalRatings} />
        </div>
      </div>

      {/* Already-connected notice */}
      {alreadyConnected && (
        <div
          style={{
            fontSize:     '0.78rem',
            color:        'var(--accent, #f59e0b)',
            background:   'rgba(245, 158, 11, 0.1)',
            border:       '1px solid rgba(245, 158, 11, 0.25)',
            borderRadius: '6px',
            padding:      '0.3rem 0.6rem',
            marginTop:    '0.5rem',
          }}
        >
          ⏳ You already have an active or pending swap with this user
        </div>
      )}

      {user.bio && <p className="peer-bio">{user.bio}</p>}

      {/* Compatibility bar — reuses existing component */}
      <CompatBar score={score} note={compatNote} />

      {/* Reason panel */}
      <RecommendationReasons reasons={reasons} />

      {/* Skills */}
      <div className="peer-skills-section">
        {user.skillsOffered?.length > 0 && (
          <div className="skills-group">
            <span className="skills-label">Teaches:</span>
            <div className="tag-list">
              {user.skillsOffered.map((s, i) => (
                <span
                  key={i}
                  className={`tag ${matchedWants?.map(w => w.toLowerCase()).includes(s.skill.toLowerCase()) ? 'tag-highlight' : ''}`}
                >
                  {s.skill} <small style={{ opacity: 0.7 }}>({s.level})</small>
                  {s.verified && <span className="badge-verified-inline" title="Admin-verified">✓</span>}
                </span>
              ))}
            </div>
          </div>
        )}

        {user.skillsWanted?.length > 0 && (
          <div className="skills-group" style={{ marginTop: '0.5rem' }}>
            <span className="skills-label">Wants to learn:</span>
            <div className="tag-list">
              {user.skillsWanted.map((s, i) => (
                <span
                  key={i}
                  className={`tag tag-wanted ${matchedOffers?.map(o => o.toLowerCase()).includes(s.skill.toLowerCase()) ? 'tag-highlight' : ''}`}
                >
                  {s.skill}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Score breakdown (compact) */}
      {scoreBreakdown && (
        <div
          style={{
            display:      'flex',
            flexWrap:     'wrap',
            gap:          '0.3rem',
            marginTop:    '0.6rem',
            fontSize:     '0.72rem',
            color:        'var(--text-muted)',
          }}
        >
          {scoreBreakdown.forwardMatch    > 0 && <span title="Forward match"    className="score-chip">↓ {scoreBreakdown.forwardMatch}pt match</span>}
          {scoreBreakdown.levelFitScore   > 0 && <span title="Skill level compatibility" className="score-chip">🎯 {scoreBreakdown.levelFitScore}pt level</span>}
          {scoreBreakdown.reverseMatch    > 0 && <span title="Reverse match"    className="score-chip">↑ {scoreBreakdown.reverseMatch}pt reverse</span>}
          {scoreBreakdown.verificationBoost > 0 && <span title="Verified skills" className="score-chip">✓ {scoreBreakdown.verificationBoost}pt verified</span>}
          {scoreBreakdown.exchangeReliability > 0 && <span title="Exchange reliability" className="score-chip">🤝 {scoreBreakdown.exchangeReliability}pt reliable</span>}
          {scoreBreakdown.ratingScore     > 0 && <span title="Rating"           className="score-chip">⭐ {scoreBreakdown.ratingScore}pt rating</span>}
          {scoreBreakdown.learningTrackMastery > 0 && <span title="Learning track mastery" className="score-chip">🎓 {scoreBreakdown.learningTrackMastery}pt mastery</span>}
          {scoreBreakdown.endorsementScore > 0 && <span title="Endorsements"    className="score-chip">👍 {scoreBreakdown.endorsementScore}pt endorsed</span>}
          {availabilityOverlap === true         && <span title="Schedule overlap" className="score-chip">⏰ schedule</span>}
        </div>
      )}

      {/* Availability calendar accordion */}
      {calOpen && (
        <div style={{ marginTop: '0.85rem' }}>
          <AvailabilityCalendar
            slots={user.availabilitySlots || []}
            peerSlots={mySlots}
            title={`${user.name}'s Free Hours`}
          />
        </div>
      )}

      {/* Footer actions */}
      <div className="peer-card-footer" style={{ display: 'flex', gap: '0.5rem', marginTop: 'auto', paddingTop: '0.85rem' }}>
        {user.availabilitySlots?.length > 0 && (
          <button
            type="button"
            className="btn btn-muted btn-sm"
            onClick={() => setCalOpen(o => !o)}
          >
            {calOpen ? 'Hide Hours' : '📅 Hours'}
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary btn-block shadow-glow"
          onClick={() => onRequestSwap && onRequestSwap(rec)}
          disabled={alreadyConnected}
          title={alreadyConnected ? 'Already connected with this user' : 'Request a skill swap'}
        >
          ⚡ {alreadyConnected ? 'Already Connected' : 'Request Swap'}
        </button>
      </div>
    </div>
  )
}
