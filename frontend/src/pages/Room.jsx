import { useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Room() {
  const { roomId } = useParams()
  const { user }   = useAuth()

  // Jitsi Meet free public server — no account needed
  const jitsiUrl = `https://meet.jit.si/${roomId}#userInfo.displayName="${encodeURIComponent(user?.name || 'User')}"`

  return (
    <div className="page" style={{ padding: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.5rem', background: 'var(--surface)' }}>
        <h3 style={{ margin: 0 }}>🎥 Video Session</h3>
        <span style={{ fontSize: '.85rem', color: 'var(--text-muted)' }}>Room: {roomId}</span>
      </div>
      <iframe
        src={jitsiUrl}
        title="Jitsi Video Call"
        style={{ width: '100%', height: 'calc(100vh - 120px)', border: 'none' }}
        allow="camera; microphone; fullscreen; display-capture"
      />
    </div>
  )
}
