import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

export const GlobalAudioContext = createContext(null)

export function useGlobalAudio() {
  return useContext(GlobalAudioContext)
}

const SPEEDS = [1, 1.5, 2]

export function useGlobalAudioProvider() {
  const [track, setTrack] = useState(null)
  // track: { url, name, chatId, chatName, messageId, durationMs }
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [speedIndex, setSpeedIndex] = useState(0)
  const audioRef = useRef(null)

  const ensureAudio = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio()
      audioRef.current.addEventListener('play', () => setPlaying(true))
      audioRef.current.addEventListener('pause', () => setPlaying(false))
      audioRef.current.addEventListener('ended', () => setPlaying(false))
      audioRef.current.addEventListener('timeupdate', () => {
        setCurrentTime(audioRef.current?.currentTime ?? 0)
      })
      audioRef.current.addEventListener('loadedmetadata', () => {
        setDuration(audioRef.current?.duration ?? 0)
      })
    }
    return audioRef.current
  }, [])

  useEffect(() => {
    if (!track) return
    const audio = ensureAudio()
    if (audio.src !== track.url) {
      audio.src = track.url
      audio.load()
      setCurrentTime(0)
      setDuration((track.durationMs || 0) / 1000)
    }
    audio.playbackRate = SPEEDS[speedIndex]
    audio.play().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track])

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = SPEEDS[speedIndex]
    }
  }, [speedIndex])

  const playTrack = useCallback((newTrack) => {
    if (track?.url === newTrack.url) {
      const audio = ensureAudio()
      if (audio.paused) audio.play().catch(() => {})
      else audio.pause()
      return
    }
    setTrack(newTrack)
  }, [track, ensureAudio])

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) audio.play().catch(() => {})
    else audio.pause()
  }, [])

  const seek = useCallback((ratio) => {
    const audio = audioRef.current
    if (!audio || !duration) return
    audio.currentTime = ratio * duration
  }, [duration])

  const dismiss = useCallback(() => {
    const audio = audioRef.current
    if (audio) { audio.pause(); audio.src = '' }
    setTrack(null)
    setPlaying(false)
    setCurrentTime(0)
  }, [])

  const cycleSpeed = useCallback(() => {
    setSpeedIndex((current) => (current + 1) % SPEEDS.length)
  }, [])

  const isTrackPlaying = useCallback((url) => {
    return track?.url === url && playing
  }, [track, playing])

  const isTrackActive = useCallback((url) => {
    return track?.url === url
  }, [track])

  return {
    track,
    playing,
    currentTime,
    duration,
    speed: SPEEDS[speedIndex],
    playTrack,
    togglePlay,
    seek,
    dismiss,
    cycleSpeed,
    isTrackPlaying,
    isTrackActive,
  }
}
