import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Pause, Play } from 'lucide-react'

const SPEEDS = [1, 1.5, 2]
const waveformCache = new Map()

function fallbackBars(seed = '') {
  let hash = 0
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) % 997
  return Array.from({ length: 32 }, (_, index) => {
    hash = (hash * 53 + index * 17 + 11) % 997
    return 18 + (hash % 62)
  })
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export default function AudioMessagePlayer({ media, compact = false }) {
  const audioRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState((media.durationMs || 0) / 1000)
  const [currentTime, setCurrentTime] = useState(0)
  const [speedIndex, setSpeedIndex] = useState(0)
  const waveformKey = `${media.id || ''}:${media.name || ''}:${media.url || ''}`
  const fallbackWaveform = useMemo(
    () => fallbackBars(media.id || media.name || media.url),
    [media.id, media.name, media.url],
  )
  const [waveformResult, setWaveformResult] = useState({ key: '', values: null })
  const [waveformLoading, setWaveformLoading] = useState(false)
  const waveform = waveformResult.key === waveformKey && waveformResult.values
    ? waveformResult.values
    : fallbackWaveform

  useEffect(() => {
    let cancelled = false
    async function loadWaveform() {
      try {
        if (!media.url || !window.AudioContext) {
          setWaveformLoading(false)
          return
        }
        if (waveformCache.has(media.url)) {
          if (!cancelled) {
            setWaveformResult({ key: waveformKey, values: waveformCache.get(media.url) })
            setWaveformLoading(false)
          }
          return
        }
        setWaveformLoading(true)
        const response = await fetch(media.url, { credentials: 'same-origin' })
        if (!response.ok) {
          if (!cancelled) setWaveformLoading(false)
          return
        }
        const buffer = await response.arrayBuffer()
        const context = new AudioContext()
        const decoded = await context.decodeAudioData(buffer.slice(0))
        const channel = decoded.getChannelData(0)
        const bars = 32
        const block = Math.max(1, Math.floor(channel.length / bars))
        const values = Array.from({ length: bars }, (_, index) => {
          let sum = 0
          const start = index * block
          const end = Math.min(channel.length, start + block)
          for (let i = start; i < end; i += 1) sum += Math.abs(channel[i])
          return Math.max(12, Math.min(82, Math.round((sum / Math.max(1, end - start)) * 240)))
        })
        await context.close()
        waveformCache.set(media.url, values)
        if (!cancelled) {
          setWaveformResult({ key: waveformKey, values })
          setWaveformLoading(false)
        }
      } catch {
        // Keep deterministic bars when decoding is blocked or the media is remote.
        if (!cancelled) setWaveformLoading(false)
      }
    }
    loadWaveform()
    return () => {
      cancelled = true
    }
  }, [media.url, waveformKey])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return undefined
    audio.playbackRate = SPEEDS[speedIndex]
  }, [speedIndex])

  const progress = duration ? Math.min(1, currentTime / duration) : 0
  const activeBars = useMemo(() => Math.round(progress * waveform.length), [progress, waveform.length])

  function toggle() {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      audio.play().catch(() => {})
    } else {
      audio.pause()
    }
  }

  function seek(event) {
    const audio = audioRef.current
    if (!audio || !duration) return
    const rect = event.currentTarget.getBoundingClientRect()
    audio.currentTime = ((event.clientX - rect.left) / rect.width) * duration
  }

  return (
    <div className={`audio-player ${compact ? 'compact' : ''}`} onClick={(event) => event.stopPropagation()}>
      <button className="audio-play" onClick={toggle} aria-label={playing ? 'Pause audio' : 'Play audio'}>
        {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
      </button>
      <button
        className={`audio-waveform ${waveformLoading ? 'loading' : ''}`}
        onClick={seek}
        aria-label={waveformLoading ? 'Analyzing audio waveform' : 'Seek audio'}
        disabled={waveformLoading && !duration}
      >
        {waveform.map((height, index) => (
          <span
            key={index}
            className={index <= activeBars ? 'active' : ''}
            style={{ '--bar-height': `${height}%` }}
          />
        ))}
        {waveformLoading && (
          <b className="audio-waveform-spinner" aria-hidden="true">
            <Loader2 size={16} />
          </b>
        )}
      </button>
      <span className="audio-time">{formatTime(duration ? duration - currentTime : 0)}</span>
      <button
        className="audio-speed"
        onClick={() => setSpeedIndex((current) => (current + 1) % SPEEDS.length)}
      >
        {SPEEDS[speedIndex]}x
      </button>
      <audio
        ref={audioRef}
        src={media.url}
        preload="metadata"
        onLoadedMetadata={(event) => {
          if (Number.isFinite(event.currentTarget.duration)) setDuration(event.currentTarget.duration)
        }}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
    </div>
  )
}
