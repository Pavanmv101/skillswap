export default function Spinner({ message = 'Loading...' }) {
  return <div className="spinner-wrap"><div className="spinner" /><p style={{color:'var(--text-muted)',fontSize:'.88rem'}}>{message}</p></div>
}
