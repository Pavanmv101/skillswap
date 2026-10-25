export default function CompatBar({ score = 0, note = '' }) {
  const color = score >= 70 ? '#10b981' : score >= 40 ? '#6366f1' : '#f59e0b'
  return (
    <div className="compat-bar">
      <div className="compat-label"><span>Compatibility</span><span style={{color}}>{score}%</span></div>
      <div className="compat-track"><div className="compat-fill" style={{width:`${score}%`,background:color}} /></div>
      {note && <p style={{fontSize:'.75rem',color:'var(--text-muted)',marginTop:'.3rem'}}>{note}</p>}
    </div>
  )
}
