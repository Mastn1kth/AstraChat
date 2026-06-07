// Desktop notifications + incoming-message sound (Telegram-style: subtle ding + native notification).

let audioContext = null

function getAudioContext() {
  if (typeof window === 'undefined') return null
  if (!audioContext) {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return null
    audioContext = new Ctx()
  }
  return audioContext
}

// Synthesized two-note "ding" so we don't depend on a binary asset.
export function playIncomingSound() {
  const ctx = getAudioContext()
  if (!ctx) return
  if (ctx.state === 'suspended') ctx.resume().catch(() => {})
  const now = ctx.currentTime
  const gain = ctx.createGain()
  gain.connect(ctx.destination)
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(0.14, now + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.33)

  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(680, now)
  osc.frequency.setValueAtTime(900, now + 0.085)
  osc.connect(gain)
  osc.start(now)
  osc.stop(now + 0.35)
}

export function canNotify() {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function notificationPermission() {
  if (!canNotify()) return 'unsupported'
  return Notification.permission
}

export async function ensureNotificationPermission() {
  if (!canNotify()) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  try {
    const result = await Notification.requestPermission()
    return result === 'granted'
  } catch {
    return false
  }
}

export function showDesktopNotification({ title, body, tag, onClick }) {
  if (!canNotify() || Notification.permission !== 'granted') return null
  try {
    const notification = new Notification(title, {
      body,
      tag,
      icon: '/favicon.svg',
      silent: true, // We play our own sound.
    })
    notification.onclick = () => {
      window.focus()
      if (onClick) onClick()
      notification.close()
    }
    return notification
  } catch {
    return null
  }
}
