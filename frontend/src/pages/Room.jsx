import { useEffect, useRef, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { io } from 'socket.io-client'
import api from '../api/axios'
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
  const pcRef              = useRef(null)
  const socketRef          = useRef(null)
  const localStreamRef     = useRef(null)
  const candidateQueueRef  = useRef([])

  // State
  const [callStatus, setCallStatus] = useState('initializing') // initializing | waiting | connecting | connected
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false)
  const [micActive, setMicActive]   = useState(true)
  const [videoActive, setVideoActive] = useState(true)
  const [screenSharing, setScreenSharing] = useState(false)
  const [copied, setCopied]         = useState(false)
  const [peerName, setPeerName]     = useState('Peer')
  const [permissionError, setPermissionError] = useState('')
  const [layoutMode, setLayoutMode] = useState('pip') // 'pip' or 'split'

  useEffect(() => {
    let mounted = true

    async function initWebRTC() {
      try {
        // 1. Get user camera and microphone stream
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: 'user',
          },
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

        // Fetch dynamic STUN + optional TURN server configuration from backend
        let iceConfiguration = ICE_SERVERS
        try {
          const { data: iceData } = await api.get('/swap/ice-servers')
          if (iceData?.iceServers?.length > 0) {
            iceConfiguration = { iceServers: iceData.iceServers }
          }
        } catch (iceErr) {
          console.warn('[WebRTC] Falling back to default STUN configuration')
        }

        // 2. Connect to backend signaling server via Socket.io
        const socketUrl =
          import.meta.env.VITE_SOCKET_URL ||
          (import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace(/\/api\/?$/, '') : '') ||
          (window.location.hostname === 'localhost' ? 'http://localhost:5001' : window.location.origin)
        const socket = io(socketUrl, {
          transports: ['websocket', 'polling'],
        })
        socketRef.current = socket

        // Helper: flush queued ICE candidates once remote description is set
        async function flushCandidateQueue(pc) {
          if (!pc || !pc.remoteDescription) return
          while (candidateQueueRef.current.length > 0) {
            const candidate = candidateQueueRef.current.shift()
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidate))
            } catch (err) {
              console.warn('Error adding queued ICE candidate:', err)
            }
          }
        }

        // Helper: create PeerConnection
        function createPeerConnection() {
          const pc = new RTCPeerConnection(iceConfiguration)
          pcRef.current = pc

          // Add all local tracks
          stream.getTracks().forEach(track => {
            pc.addTrack(track, stream)
          })

          // Handle incoming remote audio/video tracks
          pc.ontrack = (event) => {
            console.log('WebRTC ontrack event received:', event)
            if (remoteVideoRef.current) {
              if (event.streams && event.streams[0]) {
                remoteVideoRef.current.srcObject = event.streams[0]
              } else {
                let inboundStream = remoteVideoRef.current.srcObject
                if (!inboundStream || !(inboundStream instanceof MediaStream)) {
                  inboundStream = new MediaStream()
                  remoteVideoRef.current.srcObject = inboundStream
                }
                inboundStream.addTrack(event.track)
              }

              // Explicitly play to prevent autoplay blocks
              remoteVideoRef.current.play().catch(e => {
                console.warn('Autoplay caught:', e)
              })
              setHasRemoteVideo(true)
              setCallStatus('connected')
            }
          }

          // Handle local ICE candidate generation
          pc.onicecandidate = (event) => {
            if (event.candidate) {
              socket.emit('webrtc-ice-candidate', {
                roomId,
                candidate: event.candidate,
              })
            }
          }

          pc.oniceconnectionstatechange = () => {
            console.log('ICE connection state:', pc.iceConnectionState)
            if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
              setCallStatus('connected')
              setHasRemoteVideo(true)
            } else if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
              setHasRemoteVideo(false)
            }
          }

          pc.onconnectionstatechange = () => {
            console.log('PeerConnection state:', pc.connectionState)
            if (pc.connectionState === 'connected') {
              setCallStatus('connected')
              setHasRemoteVideo(true)
            } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
              setHasRemoteVideo(false)
            }
          }

          return pc
        }

        const pc = createPeerConnection()

        // 3. Socket signaling events
        socket.on('connect', () => {
          console.log('Connected to WebRTC signaling server via Socket.io')
          socket.emit('join-room', {
            roomId,
            userName: user?.name || 'Peer',
          })
          setCallStatus('waiting')
        })

        // A new user has joined the room -> We initiate the WebRTC offer
        socket.on('user-joined', async ({ userName }) => {
          setPeerName(userName || 'Peer')
          setCallStatus('connecting')
          addToast(`${userName} joined! Connecting WebRTC stream…`, 'info')

          try {
            const offer = await pc.createOffer({
              offerToReceiveAudio: true,
              offerToReceiveVideo: true,
            })
            await pc.setLocalDescription(offer)
            socket.emit('webrtc-offer', {
              roomId,
              sdp: offer,
            })
          } catch (err) {
            console.error('Error creating WebRTC offer:', err)
          }
        })

        // Received WebRTC offer -> Set remote description & return answer
        socket.on('webrtc-offer', async ({ sdp }) => {
          setCallStatus('connecting')
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(sdp))
            await flushCandidateQueue(pc)

            const answer = await pc.createAnswer({
              offerToReceiveAudio: true,
              offerToReceiveVideo: true,
            })
            await pc.setLocalDescription(answer)
            socket.emit('webrtc-answer', {
              roomId,
              sdp: answer,
            })
          } catch (err) {
            console.error('Error answering WebRTC offer:', err)
          }
        })

        // Received WebRTC answer -> Set remote description & flush queued candidates
        socket.on('webrtc-answer', async ({ sdp }) => {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(sdp))
            await flushCandidateQueue(pc)
          } catch (err) {
            console.error('Error setting remote description from answer:', err)
          }
        })

        // Received ICE candidate -> Queue if remoteDescription not ready, else add immediately
        socket.on('webrtc-ice-candidate', async ({ candidate }) => {
          if (!candidate) return
          if (!pc.remoteDescription || !pc.remoteDescription.type) {
            candidateQueueRef.current.push(candidate)
          } else {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidate))
            } catch (err) {
              console.error('Error adding ICE candidate:', err)
            }
          }
        })

        // Peer left room
        socket.on('user-left', () => {
          addToast('Peer has disconnected', 'info')
          setCallStatus('waiting')
          setHasRemoteVideo(false)
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = null
          }
        })

      } catch (err) {
        console.error('WebRTC initialization error:', err)
        setPermissionError('Could not access camera or microphone. Please verify browser permissions.')
        addToast('Camera or Microphone access required for video call', 'error')
      }
    }

    initWebRTC()

    // Cleanup on unmount
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
      addToast(audioTrack.enabled ? 'Microphone unmuted' : 'Microphone muted', 'info')
    }
  }

  // ── Turn On / Off Camera ─────────────────────────────────
  function toggleVideo() {
    if (!localStreamRef.current) return
    const videoTrack = localStreamRef.current.getVideoTracks()[0]
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled
      setVideoActive(videoTrack.enabled)
      addToast(videoTrack.enabled ? 'Camera enabled' : 'Camera disabled', 'info')
    }
  }

  // ── Screen Sharing ───────────────────────────────────────
  async function toggleScreenShare() {
    if (!screenSharing) {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true })
        const screenTrack = screenStream.getVideoTracks()[0]

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
    navigate('/swaps')
  }

  // ── Copy Room Link ───────────────────────────────────────
  function copyLink() {
    navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    addToast('Room link copied! 📋', 'success')
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
            <span className={`webrtc-status-dot ${hasRemoteVideo ? 'status-connected' : 'status-waiting'}`} />
            <strong>WebRTC P2P Session</strong>
            <span className="room-id-tag">Room: {roomId.slice(0, 18)}...</span>
          </div>
        </div>

        <div className="webrtc-top-right">
          <button
            className="btn btn-muted btn-sm"
            onClick={() => setLayoutMode(layoutMode === 'pip' ? 'split' : 'pip')}
          >
            {layoutMode === 'pip' ? '⊞ Split View' : '⊡ Picture-in-Picture'}
          </button>

          <span className="webrtc-badge">
            {hasRemoteVideo ? '⚡ Live P2P Stream' : callStatus === 'connecting' ? '🔄 Handshaking…' : '⏳ Waiting for Partner'}
          </span>

          <button className="btn btn-ghost btn-sm" onClick={copyLink}>
            {copied ? '✓ Copied' : '🔗 Copy Link'}
          </button>
        </div>
      </div>

      {permissionError && (
        <div className="alert alert-error" style={{ margin: '1rem' }}>
          ⚠ {permissionError}
        </div>
      )}

      {/* Main Video Area */}
      <div className={`webrtc-video-grid layout-${layoutMode}`}>
        {/* Remote Video Box (Peer) */}
        <div className="webrtc-video-box remote-video-box">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="webrtc-video-element"
          />

          {!hasRemoteVideo && (
            <div className="webrtc-waiting-overlay">
              <div className="waiting-spinner-pulse" />
              <h3>Waiting for partner to join...</h3>
              <p style={{ color: 'var(--text-subtle)', fontSize: '.88rem', maxWidth: 440, margin: '.5rem auto 1.25rem' }}>
                Both students join this room for a direct peer-to-peer WebRTC connection.
              </p>
              <button className="btn btn-primary btn-sm shadow-glow" onClick={copyLink}>
                📋 Copy Invite Link
              </button>
            </div>
          )}

          <div className="video-label-pill peer-label">
            <span>👤 {hasRemoteVideo ? peerName : 'Peer'}</span>
            {hasRemoteVideo && <span className="live-pill">● LIVE</span>}
          </div>
        </div>

        {/* Local Video Box (You) */}
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

      {/* Floating Bottom Control Bar */}
      <div className="webrtc-control-bar">
        <button
          className={`control-btn ${!micActive ? 'control-btn-danger' : ''}`}
          onClick={toggleAudio}
          title={micActive ? 'Mute Mic' : 'Unmute Mic'}
        >
          {micActive ? '🎤 Mute' : '🔇 Unmuted'}
        </button>

        <button
          className={`control-btn ${!videoActive ? 'control-btn-danger' : ''}`}
          onClick={toggleVideo}
          title={videoActive ? 'Stop Video' : 'Start Video'}
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
          title="End Call"
        >
          🔴 End Session
        </button>
      </div>
    </div>
  )
}
