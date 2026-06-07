import { useMemo } from 'react'

function buildLane(words, laneIndex) {
  const wordCount = Math.max(10, Math.min(18, words.length * 3))

  return Array.from({ length: wordCount }, (_, wordIndex) => {
    const index = (laneIndex * 5 + wordIndex * 3) % words.length
    return words[index]
  })
}

export default function WordStreamBackground({ words, settings }) {
  const lanes = useMemo(
    () =>
      Array.from({ length: settings.density }, (_, index) => ({
        id: index,
        words: buildLane(words, index),
        duration: (48 + (index % 4) * 7) / settings.speed,
        delay: -(index * 5.5),
      })),
    [settings.density, settings.speed, words],
  )

  if (!settings.enabled || !words.length) return null

  return (
    <div
      className="word-stream-background"
      aria-hidden="true"
      style={{
        '--word-stream-opacity': settings.opacity,
        '--word-stream-blur': `${settings.blur}px`,
      }}
    >
      {lanes.map((lane, index) => (
        <div
          className={`word-stream-lane ${index % 2 ? 'reverse' : ''}`}
          key={lane.id}
          style={{
            '--lane-top': `${((index + 0.5) / lanes.length) * 100}%`,
            '--lane-duration': `${lane.duration}s`,
            '--lane-delay': `${lane.delay}s`,
          }}
        >
          <div className="word-stream-track">
            {[0, 1].map((copy) => (
              <div className="word-stream-phrase" key={copy}>
                {lane.words.map((word, wordIndex) => (
                  <span key={`${copy}-${wordIndex}`}>{word}</span>
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
