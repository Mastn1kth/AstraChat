import { useMemo } from 'react'

function getPeakHour(messages) {
  const counts = new Array(24).fill(0)
  for (const msg of messages) {
    if (msg.deleted) continue
    const d = new Date(msg.time)
    if (!isNaN(d)) counts[d.getHours()]++
  }
  const max = Math.max(...counts)
  if (max === 0) return null
  return counts.indexOf(max)
}

function getStreak(messages) {
  const days = new Set()
  for (const msg of messages) {
    if (msg.deleted) continue
    const d = new Date(msg.time)
    if (!isNaN(d)) {
      days.add(d.toDateString())
    }
  }
  const sorted = [...days].sort((a, b) => new Date(b) - new Date(a))
  if (!sorted.length) return 0

  let streak = 1
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1])
    const curr = new Date(sorted[i])
    const diff = (prev - curr) / 86400000
    if (Math.round(diff) === 1) {
      streak++
    } else {
      break
    }
  }
  return streak
}

export default function FocusSchedule({ messages, contact }) {
  const stats = useMemo(() => {
    const visible = messages.filter((m) => !m.deleted)
    const peakHour = getPeakHour(visible)
    const streak = getStreak(visible)
    return { count: visible.length, peakHour, streak }
  }, [messages])

  if (contact?.type !== 'private' || messages.length < 2) return null

  const peakLabel = stats.peakHour !== null
    ? `${stats.peakHour}:00–${stats.peakHour + 1}:00`
    : '—'

  return (
    <div className="focus-schedule-card">
      <div className="focus-stat">
        <span className="focus-stat-value">{stats.count}</span>
        <span className="focus-stat-label">сообщений</span>
      </div>
      <div className="focus-stat">
        <span className="focus-stat-value">{peakLabel}</span>
        <span className="focus-stat-label">пик активности</span>
      </div>
      <div className="focus-stat">
        <span className="focus-stat-value">{stats.streak}</span>
        <span className="focus-stat-label">{stats.streak === 1 ? 'день подряд' : stats.streak < 5 ? 'дня подряд' : 'дней подряд'}</span>
      </div>
    </div>
  )
}
