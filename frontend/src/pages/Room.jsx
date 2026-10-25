import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'

export default function Room() {
  const { roomId } = useParams()
  const { user }   = useAuth()
  const { addToast } = useToast()
  const [copied, setCopied] = useState(false)

  // Jitsi Meet free public room URL
  const jitsiUrl = `https://meet.jit.si/${roomId}#userInfo.displayName="${encodeURIComponent(user?.name || 'Peer')}"`

  function copyMeetingLink() {
    navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    addToast('Video session link copied to clipboard! 📋', 'success')
    setTimeout(() => setCopied(false), 3000)
  }

  return (
    <div className="room-container">
      {/* Room Toolbar */}
      <div className="room-top-bar">
        <div className="room-left">
          <Link to="/swaps" className="btn btn-muted btn-sm">
            ← Exit Session
          </Link>
          <div className="room-title-info">
            <span className="room-live-dot"></span>
            <strong>Live Skill Barter Session</strong>
            <span className="room-id-tag">Room: {roomId}</span>
          </div>
        </div>

        <div className="room-right">
          <button className="btn btn-ghost btn-sm" onClick={copyMeetingLink}>
            {copied ? '✓ Link Copied' : '🔗 Copy Session Link'}
          </button>
          <Link to="/swaps" className="btn btn-primary btn-sm">
            End & Return to Swaps
          </Link>
        </div>
      </div>

      {/* Embedded Jitsi WebRTC frame */}
      <div className="room-frame-wrapper">
        <iframe
          src={jitsiUrl}
          title="Jitsi Video Session"
          className="jitsi-iframe"
          allow="camera; microphone; fullscreen; display-capture; autoplay"
        />
      </div>
    </div>
  )
}
