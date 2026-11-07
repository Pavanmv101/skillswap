/**
 * ScoreBadge.jsx — Phase 5
 * Coloured tier badge for recommendation scores.
 * Tiers: Excellent (80+), Good (55–79), Fair (30–54), Low (<30)
 */
export default function ScoreBadge({ score, className = '', style = {} }) {
  const s = Math.round(score ?? 0)

  let label, color, bg
  if (s >= 80) {
    label = 'Excellent Match'
    color = '#10b981'
    bg    = 'rgba(16, 185, 129, 0.12)'
  } else if (s >= 55) {
    label = 'Good Match'
    color = '#6366f1'
    bg    = 'rgba(99, 102, 241, 0.12)'
  } else if (s >= 30) {
    label = 'Fair Match'
    color = '#f59e0b'
    bg    = 'rgba(245, 158, 11, 0.12)'
  } else {
    label = 'Low Match'
    color = 'var(--text-muted)'
    bg    = 'var(--surface-subtle)'
  }

  return (
    <span
      className={`score-badge ${className}`.trim()}
      style={{
        display:       'inline-flex',
        alignItems:    'center',
        gap:           '0.3rem',
        padding:       '0.2rem 0.6rem',
        borderRadius:  '999px',
        fontSize:      '0.76rem',
        fontWeight:    700,
        letterSpacing: '0.01em',
        color,
        background:    bg,
        border:        `1px solid ${color}33`,
        flexShrink:    0,
        maxWidth:      '100%',
        boxSizing:     'border-box',
        ...style,
      }}
      title={`Compatibility score: ${s}/100 — ${label}`}
    >
      <span style={{ fontSize: '0.65rem' }}>◉</span>
      <span className="score-badge-pct">{s}%</span>
      <span className="score-badge-label">— {label}</span>
    </span>
  )
}
