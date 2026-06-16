import { useEffect, useRef, useState } from 'react'
import {
  Mic,
  MicOff,
  MonitorUp,
  Phone,
  PhoneOff,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'

const statusText = {
  preparing: 'Preparing devices...',
  ringing: 'Ringing...',
  connecting: 'Connecting...',
  active: 'Encrypted peer-to-peer call',
  reconnecting: 'Reconnecting...',
  declined: 'Call declined',
  ended: 'Call ended',
  unavailable: 'User unavailable',
  failed: 'Connection failed',
}

function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function StreamVideo({ stream, muted = false, className = '' }) {
  const ref = useRef(null)

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream || null
  }, [stream])

  return (
    <video
      ref={ref}
      className={className}
      autoPlay
      playsInline
      muted={muted}
    />
  )
}

function StreamAudio({ stream, muted }) {
  const ref = useRef(null)

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream || null
  }, [stream])

  return <audio ref={ref} autoPlay muted={muted} />
}

export default function CallModal({
  call,
  localStream,
  remoteStream,
  remoteStreams = {},
  connectionStats,
  onAccept,
  onEnd,
  onDismiss,
  onToggleMute,
  onToggleCamera,
  onToggleSpeaker,
  onToggleScreenShare,
}) {
  const [duration, setDuration] = useState(0)
  const terminal = ['declined', 'ended', 'unavailable', 'failed'].includes(call.status)
  const incoming = call.direction === 'incoming' && call.status === 'ringing'
  const participants = call.participants?.length
    ? call.participants
    : [{ ...call.peer, state: call.status === 'active' ? 'connected' : call.status }]
  const remoteVideoEntries = Object.entries(remoteStreams).filter(([, stream]) =>
    call.kind === 'video' && stream?.getVideoTracks().length > 0
  )
  const hasRemoteVideo = remoteVideoEntries.length > 0 || (
    call.kind === 'video' && remoteStream?.getVideoTracks().length > 0
  )
  const hasLocalVideo = localStream?.getVideoTracks().length > 0 && !call.cameraOff
  const quality = connectionStats || {
    level: call.status === 'active' ? 'unknown' : 'idle',
    label: call.status === 'active' ? 'Measuring' : 'Waiting',
    packetsLost: 0,
    packetsReceived: 0,
    lossRate: 0,
    jitterMs: 0,
  }
  const lossPercent = Math.round((quality.lossRate || 0) * 100)

  useEffect(() => {
    if (call.status !== 'active') return undefined
    const startedAt = call.connectedAt || Date.now()
    const update = () => setDuration(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)))
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [call.connectedAt, call.status])

  return (
    <div className="call-overlay" role="dialog" aria-modal="true" aria-label={`${call.kind} call`}>
      <section className={`call-window ${call.kind === 'video' ? 'video-call' : 'audio-call'}`}>
        <header className="call-topbar">
          <div>
            <strong>{call.kind === 'video' ? 'Video call' : 'Audio call'}</strong>
            <span>{call.status === 'active' ? formatDuration(duration) : statusText[call.status]}</span>
          </div>
          <div
            className={`call-quality ${quality.level}`}
            title={`Packet loss ${lossPercent}%, jitter ${quality.jitterMs || 0} ms`}
            aria-label={`Connection quality: ${quality.label}. Packet loss ${lossPercent} percent, jitter ${quality.jitterMs || 0} milliseconds.`}
          >
            <i />
            <span>{quality.label}</span>
            <small>{lossPercent}% loss / {quality.jitterMs || 0} ms</small>
          </div>
          <button onClick={terminal ? onDismiss : onEnd} aria-label="Close call">
            <X size={20} />
          </button>
        </header>

        <div className={`call-media ${participants.length > 2 ? 'group-call-media' : ''}`}>
          {hasRemoteVideo && participants.length > 2 ? (
            <div className="call-video-grid">
              {remoteVideoEntries.map(([userId, stream]) => {
                const participant = participants.find((item) => item.id === userId)
                return (
                  <div className="call-video-tile" key={userId}>
                    <StreamVideo
                      stream={stream}
                      muted={call.speakerMuted}
                      className="remote-video"
                    />
                    <span>{participant?.name || 'Participant'}</span>
                  </div>
                )
              })}
              {hasLocalVideo && (
                <div className="call-video-tile local-tile">
                  <StreamVideo stream={localStream} muted className="remote-video" />
                  <span>You</span>
                </div>
              )}
            </div>
          ) : hasRemoteVideo ? (
            <StreamVideo
              stream={remoteStream || remoteVideoEntries[0]?.[1]}
              muted={call.speakerMuted}
              className="remote-video"
            />
          ) : (
            <div className="call-identity">
              <div className={`call-avatar ${call.status === 'ringing' ? 'ringing' : ''}`}>
                {call.peer.avatar}
              </div>
              <h2>{call.peer.name}</h2>
              <p>{call.error || statusText[call.status]}</p>
            </div>
          )}

          {call.kind === 'video' && hasLocalVideo && participants.length <= 2 && (
            <StreamVideo stream={localStream} muted className="local-video" />
          )}

          {!hasRemoteVideo && <StreamAudio stream={remoteStream} muted={call.speakerMuted} />}
          {Object.entries(remoteStreams)
            .filter(([, stream]) => !stream?.getVideoTracks().length)
            .map(([userId, stream]) => (
            <StreamAudio key={userId} stream={stream} muted={call.speakerMuted} />
          ))}

          {hasRemoteVideo && (
            <div className="video-call-caption">
              <strong>{call.peer.name}</strong>
              <span>{call.status === 'active' ? formatDuration(duration) : statusText[call.status]}</span>
            </div>
          )}
        </div>

        {participants.length > 1 && (
          <div className="call-participants">
            {participants.map((participant) => (
              <div className="call-participant" key={participant.id}>
                <span className={`participant-dot ${participant.state || 'invited'}`} />
                <strong>{participant.self ? 'You' : participant.name}</strong>
                <small>
                  {participant.sharingScreen
                    ? 'sharing screen'
                    : participant.state || 'invited'}
                </small>
              </div>
            ))}
          </div>
        )}

        {incoming ? (
          <div className="incoming-call-actions">
            <button className="decline-call" onClick={onEnd}>
              <PhoneOff size={22} />
              <span>Decline</span>
            </button>
            <button className="accept-call" onClick={onAccept}>
              <Phone size={22} />
              <span>Accept</span>
            </button>
          </div>
        ) : terminal ? (
          <div className="terminal-call-actions">
            <button onClick={onDismiss}>Close</button>
          </div>
        ) : (
          <div className="call-controls">
            <button
              className={call.muted ? 'active' : ''}
              onClick={onToggleMute}
              title={call.muted ? 'Unmute microphone' : 'Mute microphone'}
            >
              {call.muted ? <MicOff size={21} /> : <Mic size={21} />}
            </button>
            {call.kind === 'video' && (
              <button
                className={call.cameraOff ? 'active' : ''}
                onClick={onToggleCamera}
                title={call.cameraOff ? 'Turn camera on' : 'Turn camera off'}
              >
                {call.cameraOff ? <VideoOff size={21} /> : <Video size={21} />}
              </button>
            )}
            <button
              className={call.speakerMuted ? 'active' : ''}
              onClick={onToggleSpeaker}
              title={call.speakerMuted ? 'Turn speaker on' : 'Mute speaker'}
            >
              {call.speakerMuted ? <VolumeX size={21} /> : <Volume2 size={21} />}
            </button>
            {call.kind === 'video' && (
              <button
                className={call.sharingScreen ? 'active' : ''}
                onClick={onToggleScreenShare}
                title={call.sharingScreen ? 'Stop sharing screen' : 'Share screen'}
              >
                <MonitorUp size={21} />
              </button>
            )}
            <button className="danger-call" onClick={onEnd} title="End call">
              <PhoneOff size={21} />
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
