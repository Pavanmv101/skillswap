import { useEffect, useRef, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { io } from 'socket.io-client'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
}

export default function Room() {
  const { roomId } = useParams()
  const { user } = useAuth()
  const { addToast } = useToast()
  const navigate = useNavigate()

  // Video element refs
  const localVideoRef  = useRef(null)
  const remoteVideoRef = useRef(null)

  // WebRTC & Socket refs
  const pcRef     = useRef(null)
  const socketRef = useRef(null)
  const localStreamRef = useRef(null)

  // State
  const [callStatus, setCallStatus] = useState('initializing') // initializing | waiting | connecting | connected | ended
  const [micActive, setMicActive]   = useState(true)
  const [videoActive, setVideoActive] = useState(true)
  const [screenSharing, setScreenSharing] = useState(false)
  const [copied, setCopied]         = useState(false)
  const [peerName, setPeerName]     = useState('Peer')
  const [permissionError, setPermissionError] = useState('')

  useEffect(() => {
    let mounted = true

    async function initWebRTC() {
      try {
        // 1. Get user camera and microphone stream
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        })

        if (!mounted) {
          stream.getTracks().forEach(t => t.stop())
          return
        }

        localStreamRef.current = stream
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream
        }

        // 2. Connect to backend signaling server via Socket.io
        // Points to origin port 5001 (or current host if proxied)
        const socketUrl = window.location.hostname === 'localhost' ? 'http://localhost:5001' : window.location.origin
        const socket = io(socketUrl, {
          transports: ['websocket', 'polling'],
        })
        socketRef.current = socket

        // Setup RTCPeerConnection helper
        function createPeerConnection() {
          const pc = new RTCPeerConnection(ICE_SERVERS)
          pcRef.current = pc

          // Add local audio and video tracks to WebRTC peer connection
          stream.getTracks().forEach(track => {
            pc.addTrack(track, stream)
          })

          // Handle incoming remote audio/video stream from peer
          pc.ontrack = (event) => {
            console.log('WebRTC remote track received:', event.streams[0])
            if (remoteVideoRef.current && event.streams[0]) {
              remoteVideoRef.current.srcObject = event.streams[0]
              setCallStatus('connected')
              addToast('Peer connected via native WebRTC! ⚡', 'success')
            }
          }

          // Handle ICE candidates
          pc.onicecandidate = (event) => {
            if (event.candidate) {
              socket.emit('webrtc-ice-candidate', {
                roomId,
                candidate: event.candidate,
              })
            }
          }

          pc.onconnectionstatechange = () => {
            console.log('WebRTC connection state:', pc.connectionState)
            if (pc.connectionState === 'connected') {
              setCallStatus('connected')
            } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
              setCallStatus('waiting')
            }
          }

          return pc
        }

        const pc = createPeerConnection()

        // 3. Socket signaling events
        socket.on('connect', () => {
          console.log('Connected to WebRTC signaling server')
          socket.emit('join-room', {
            roomId,
            userName: user?.name || 'Peer',
          })
          setCallStatus('waiting')
        })

        // Another user has joined -> create offer as initiator
        socket.on('user-joined', async ({ userName }) => {
          setPeerName(userName || 'Peer')
          setCallStatus('connecting')
          addToast(`${userName} joined the room! Initiating WebRTC offer...`, 'info')

          try {
            const offer = await pc.createOffer()
            await pc.setLocalDescription(offer)
            socket.emit('webrtc-offer', {
              roomId,
              sdp: offer,
            })
          } catch (err) {
            console.error('Error creating WebRTC offer:', err)
          }
        })

        // Received WebRTC offer -> create answer
        socket.on('webrtc-offer', async ({ sdp, senderId }) => {
          setCallStatus('connecting')
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(sdp))
            const answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)
            socket.emit('webrtc-answer', {
              roomId,
              sdp: answer,
            })
          } catch (err) {
            console.error('Error answering WebRTC offer:', err)
          }
        })

        // Received WebRTC answer
        socket.on('webrtc-answer', async ({ sdp }) => {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(sdp))
          } catch (err) {
            console.error('Error setting remote description:', err)
          }
        })

        // Received ICE candidate
        socket.on('webrtc-ice-candidate', async ({ candidate }) => {
          try {
            if (candidate && pc.remoteDescription) {
              await pc.addIceCandidate(new RTCIceCandidate(candidate))
            }
          } catch (err) {
            console.error('Error adding ICE candidate:', err)
          }
        })

        // Peer left room
        socket.on('user-left', () => {
          addToast('Peer has left the call', 'info')
          setCallStatus('waiting')
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = null
          }
        })

      } catch (err) {
        console.error('WebRTC media error:', err)
        setPermissionError('Could not access camera or microphone. Please check browser permissions.')
        addToast('Camera or Microphone access required for WebRTC', 'error')
      }
    }

    initWebRTC()

    // Cleanup when component unmounts
    return () => {
      mounted = false
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop())
      }
      if (pcRef.current) {
        pcRef.current.close()
      }
      if (socketRef.current) {
        socketRef.current.emit('leave-room', { roomId })
        socketRef.current.disconnect()
      }
    }
  }, [roomId, user, addToast])

  // ── Mute / Unmute Audio ──────────────────────────────────
  function toggleAudio() {
    if (!localStreamRef.current) return
    const audioTrack = localStreamRef.current.getAudioTracks()[0]
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled
      setMicActive(audioTrack.enabled)
      addToast(audioTrack.enabled ? 'Microphone on' : 'Microphone muted', 'info')
    }
  }

  // ── Enable / Disable Camera ──────────────────────────────
  function toggleVideo() {
    if (!localStreamRef.current) return
    const videoTrack = localStreamRef.current.getVideoTracks()[0]
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled
      setVideoActive(videoTrack.enabled)
      addToast(videoTrack.enabled ? 'Camera turned on' : 'Camera turned off', 'info')
    }
  }

  // ── Screen Sharing via WebRTC ────────────────────────────
  async function toggleScreenShare() {
    if (!screenSharing) {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true })
        const screenTrack = screenStream.getVideoTracks()[0]

        // Replace outgoing video track in WebRTC sender
        const sender = pcRef.current?.getSenders().find(s => s.track?.kind === 'video')
        if (sender) {
          sender.replaceTrack(screenTrack)
        }

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = screenStream
        }

        screenTrack.onended = () => {
          stopScreenShare()
        }

        setScreenSharing(true)
        addToast('Screen sharing started 🖥️', 'success')
      } catch (err) {
        console.error('Screen share error:', err)
      }
    } else {
      stopScreenShare()
    }
  }

  function stopScreenShare() {
    const videoTrack = localStreamRef.current?.getVideoTracks()[0]
    const sender = pcRef.current?.getSenders().find(s => s.track?.kind === 'video')
    if (sender && videoTrack) {
      sender.replaceTrack(videoTrack)
    }
    if (localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current
    }
    setScreenSharing(false)
    addToast('Stopped screen sharing', 'info')
  }

  // ── End Call ─────────────────────────────────────────────
  function handleEndCall() {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop())
    }
    if (pcRef.current) {
      pcRef.current.close()
    }
    if (socketRef.current) {
      socketRef.current.emit('leave-room', { roomId })
      socketRef.current.disconnect()
    }
    addToast('Session ended', 'info')
    navigate('/swaps')
  }

  // ── Copy Link ────────────────────────────────────────────
  function copyLink() {
    navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    addToast('Meeting link copied to clipboard! 📋', 'success')
    setTimeout(() => setCopied(false), 3000)
  }

  return (
    <div className="webrtc-room-container">
      {/* Top Header Bar */}
      <div className="webrtc-top-bar">
        <div className="webrtc-top-left">
          <Link to="/swaps" className="btn btn-muted btn-sm">
            ← Exit
          </Link>
          <div className="webrtc-room-info">
            <span className={`webrtc-status-dot ${callStatus === 'connected' ? 'status-connected' : 'status-waiting'}`} />
            <strong>WebRTC Peer Session</strong>
            <span className="room-id-tag">Room: {roomId}</span>
          </div>
        </div>

        <div className="webrtc-top-right">
          <span className="webrtc-badge">
            {callStatus === 'connected' && '⚡ P2P Encrypted Call'}
            {callStatus === 'connecting' && '🔄 Establishing P2P Connection...'}
            {callStatus === 'waiting' && '⏳ Waiting for peer to join room'}
            {callStatus === 'initializing' && '⚙️ Setting up camera...'}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={copyLink}>
            {copied ? '✓ Copied' : '🔗 Copy Room Link'}
          </button>
        </div>
      </div>

      {permissionError && (
        <div className="alert alert-error" style={{ margin: '1rem' }}>
          ⚠ {permissionError}
        </div>
      )}

      {/* Video Grid Area */}
      <div className="webrtc-video-grid">
        {/* Remote Video (Peer) */}
        <div className="webrtc-video-box remote-video-box">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="webrtc-video-element"
          />

          {callStatus !== 'connected' && (
            <div className="webrtc-waiting-overlay">
              <div className="waiting-spinner-pulse" />
              <h3>Waiting for your partner to join...</h3>
              <p style={{ color: 'var(--text-subtle)', fontSize: '.88rem', maxWidth: 400, margin: '.5rem auto 1rem' }}>
                Both participants join this same room via WebRTC peer-to-peer connection.
              </p>
              <button className="btn btn-primary btn-sm shadow-glow" onClick={copyLink}>
                📋 Copy Invite Link
              </button>
            </div>
          )}

          <div className="video-label-pill peer-label">
            <span>👤 {callStatus === 'connected' ? peerName : 'Peer (Offline)'}</span>
          </div>
        </div>

        {/* Local Video (You - Picture-in-Picture) */}
        <div className={`webrtc-video-box local-video-box ${!videoActive ? 'video-off' : ''}`}>
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="webrtc-video-element local-mirror"
          />
          {!videoActive && (
            <div className="camera-off-placeholder">
              <span>📷 Camera Off</span>
            </div>
          )}
          <div className="video-label-pill you-label">
            <span>You ({user?.name || 'Me'})</span>
            {!micActive && <span style={{ color: '#ef4444' }}>🔇 Muted</span>}
          </div>
        </div>
      </div>

      {/* Bottom Floating Control Bar */}
      <div className="webrtc-control-bar">
        <button
          className={`control-btn ${!micActive ? 'control-btn-danger' : ''}`}
          onClick={toggleAudio}
          title={micActive ? 'Mute Microphone' : 'Unmute Microphone'}
        >
          {micActive ? '🎤 Mute' : '🔇 Unmuted'}
        </button>

        <button
          className={`control-btn ${!videoActive ? 'control-btn-danger' : ''}`}
          onClick={toggleVideo}
          title={videoActive ? 'Turn Off Camera' : 'Turn On Camera'}
        >
          {videoActive ? '📹 Stop Video' : '📷 Start Video'}
        </button>

        <button
          className={`control-btn ${screenSharing ? 'control-btn-active' : ''}`}
          onClick={toggleScreenShare}
          title="Share Screen"
        >
          {screenSharing ? '🖥️ Stop Share' : '🖥️ Share Screen'}
        </button>

        <button
          className="control-btn control-btn-hangup"
          onClick={handleEndCall}
          title="Hang Up"
        >
          🔴 End Session
        </button>
      </div>
    </div>
  )
}
