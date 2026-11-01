/**
 * SkillSuggestionPill.jsx — Phase 5
 * A single pill displaying a suggested skill with partner count and reason tooltip.
 * "Add to Goals" links to the Profile page.
 */
import { Link } from 'react-router-dom'

export default function SkillSuggestionPill({ suggestion }) {
  const { skill, category, potentialPartners, reason } = suggestion

  return (
    <div
      title={reason}
      style={{
        display:       'inline-flex',
        alignItems:    'center',
        gap:           '0.5rem',
        padding:       '0.45rem 0.8rem',
        borderRadius:  '999px',
        border:        '1px solid var(--border, #e2e8f0)',
        background:    'var(--card-bg, #fff)',
        fontSize:      '0.82rem',
        whiteSpace:    'nowrap',
        cursor:        'default',
      }}
    >
      <span style={{ fontWeight: 600 }}>{skill}</span>
      {category && category !== 'General' && (
        <span style={{ fontSize: '0.72rem', color: 'var(--text-muted, #64748b)' }}>
          {category}
        </span>
      )}
      <span
        style={{
          background:   '#eff6ff',
          color:        '#2563eb',
          borderRadius: '999px',
          padding:      '0.1rem 0.45rem',
          fontSize:     '0.72rem',
          fontWeight:   700,
        }}
      >
        {potentialPartners} partner{potentialPartners !== 1 ? 's' : ''}
      </span>
      <Link
        to="/profile"
        style={{
          fontSize:     '0.72rem',
          fontWeight:   600,
          color:        'var(--primary, #6366f1)',
          textDecoration: 'none',
          padding:      '0.1rem 0.4rem',
          borderRadius: '6px',
          background:   'rgba(99,102,241,0.08)',
        }}
      >
        + Add
      </Link>
    </div>
  )
}
