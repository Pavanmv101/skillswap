export default function CompatBar({ score = 0, note = '' }) {
  const isHigh = score >= 70
  const isMedium = score >= 40
  const color = isHigh ? '#10b981' : isMedium ? '#6366f1' : '#f59e0b'
  const badgeLabel = isHigh ? '⚡ Strong Match' : isMedium ? 'Good Match' : 'Potential Match'

  return (
    <div className="compat-bar">
      <div className="compat-label">
        <span className="compat-badge" style={{ color, borderColor: `${color}40`, background: `${color}12` }}>
          {badgeLabel}
        </span>
        <span className="compat-score-text" style={{ color }}>{score}% Match</span>
      </div>
      <div className="compat-track">
        <div
          className="compat-fill"
          style={{
            width: `${score}%`,
            background: `linear-gradient(90deg, ${color}, ${isHigh ? '#34d399' : '#818cf8'})`
          }}
        />
      </div>
      {note && <p className="compat-note">{note}</p>}
    </div>
  )
}
