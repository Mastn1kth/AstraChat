import { useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export default function VideoNotePlayer({ media }) {
  const videoRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState((media.durationMs || 0) / 1000)

  function toggle(event) {
    event.stopPropagation()
    const video = videoRef.current
    if (!video) return
    if (video.paused) video.play().catch(() => {})
    else video.pause()
  }

  return (
    <div className="video-note-player" onClick={(event) => event.stopPropagation()}>
      <video
        ref={videoRef}
        src={media.url}
        preload="metadata"
        playsInline
        onLoadedMetadata={(event) => {
          if (Number.isFinite(event.currentTarget.duration)) setDuration(event.currentTarget.duration)
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onClick={toggle}
      />
      <button className="video-note-play-overlay" onClick={toggle} aria-label={playing ? 'Pause video message' : 'Play video message'}>
        {!playing && <Play size={28} fill="currentColor" />}
        {playing && <Pause size={20} fill="currentColor" />}
      </button>
      <span className="video-note-duration">{formatTime(duration)}</span>
    </div>
  )
}
