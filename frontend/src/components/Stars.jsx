export default function Stars({ value = 0, count }) {
  const r = Math.round(value)
  return <span className="stars">{'★'.repeat(r)}{'☆'.repeat(5 - r)}{count !== undefined && <span style={{color:'var(--text-muted)',fontSize:'.78rem',marginLeft:'.3rem',fontWeight:500}}>({count})</span>}</span>
}
