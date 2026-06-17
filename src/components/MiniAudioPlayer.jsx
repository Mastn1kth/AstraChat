import { Pause, Play, X } from 'lucide-react'
import { useGlobalAudio } from '../hooks/useGlobalAudio'

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export default function MiniAudioPlayer() {
  const { track, playing, currentTime, duration, speed, togglePlay, seek, dismiss, cycleSpeed } = useGlobalAudio()

  if (!track) return null

  const progress = duration ? Math.min(1, currentTime / duration) : 0
  const remaining = duration ? duration - currentTime : 0

  function handleSeek(event) {
    const rect = event.currentTarget.getBoundingClientRect()
    seek((event.clientX - rect.left) / rect.width)
  }

  return (
    <div className="mini-audio-player">
      <button className="mini-audio-play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
      </button>

      <div className="mini-audio-info">
        <span className="mini-audio-name">{track.name || 'Voice message'}</span>
        {track.chatName && <span className="mini-audio-chat">{track.chatName}</span>}
      </div>

      <div className="mini-audio-progress-wrap" onClick={handleSeek} role="slider" aria-label="Seek" aria-valuenow={Math.round(progress * 100)}>
        <div className="mini-audio-progress-bar">
          <div className="mini-audio-progress-fill" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>

      <span className="mini-audio-time">{formatTime(remaining)}</span>

      <button className="mini-audio-speed" onClick={cycleSpeed} title="Playback speed">
        {speed}x
      </button>

      <button className="mini-audio-close" onClick={dismiss} aria-label="Close player">
        <X size={16} />
      </button>
    </div>
  )
}
