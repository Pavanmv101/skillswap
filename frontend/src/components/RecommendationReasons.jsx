/**
 * RecommendationReasons.jsx — Phase 5
 * Collapsible panel showing why a user was recommended.
 */
import { useState } from 'react'

export default function RecommendationReasons({ reasons = [] }) {
  const [open, setOpen] = useState(false)

  if (!reasons || reasons.length === 0) return null

  return (
    <div style={{ marginTop: '0.6rem' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          background:  'none',
          border:      'none',
          cursor:      'pointer',
          color:       'var(--primary, #6366f1)',
          fontSize:    '0.8rem',
          fontWeight:  600,
          padding:     0,
          display:     'flex',
          alignItems:  'center',
          gap:         '0.3rem',
        }}
      >
        {open ? '▾' : '▸'} Why recommended?
      </button>

      {open && (
        <ul
          style={{
            margin:     '0.45rem 0 0 0',
            padding:    '0.6rem 0.75rem',
            listStyle:  'none',
            background: 'var(--surface-subtle)',
            border:     '1px solid var(--border)',
            borderRadius: '8px',
            fontSize:   '0.8rem',
            lineHeight: 1.6,
            color:      'var(--text-secondary)',
          }}
        >
          {reasons.map((r, i) => (
            <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.4rem' }}>
              <span style={{ color: 'var(--primary)', marginTop: '0.1rem' }}>✦</span>
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
