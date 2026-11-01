/**
 * ScoreBadge.jsx — Phase 5
 * Coloured tier badge for recommendation scores.
 * Tiers: Excellent (80+), Good (55–79), Fair (30–54), Low (<30)
 */
export default function ScoreBadge({ score }) {
  const s = Math.round(score ?? 0)

  let label, color, bg
  if (s >= 80) {
    label = 'Excellent Match'
    color = '#059669'
    bg    = '#ecfdf5'
  } else if (s >= 55) {
    label = 'Good Match'
    color = '#2563eb'
    bg    = '#eff6ff'
  } else if (s >= 30) {
    label = 'Fair Match'
    color = '#d97706'
    bg    = '#fffbeb'
  } else {
    label = 'Low Match'
    color = '#6b7280'
    bg    = '#f9fafb'
  }

  return (
    <span
      style={{
        display:       'inline-flex',
        alignItems:    'center',
        gap:           '0.3rem',
        padding:       '0.2rem 0.65rem',
        borderRadius:  '999px',
        fontSize:      '0.78rem',
        fontWeight:    700,
        letterSpacing: '0.01em',
        color,
        background:    bg,
        border:        `1px solid ${color}33`,
        whiteSpace:    'nowrap',
      }}
      title={`Compatibility score: ${s}/100`}
    >
      <span style={{ fontSize: '0.7rem' }}>◉</span>
      {s}% — {label}
    </span>
  )
}
