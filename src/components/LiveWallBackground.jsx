import { useEffect, useMemo, useState } from 'react'
import { sampleLibraryWords } from '../utils/liveWall'

const MOBILE_QUERY = '(max-width: 920px)'

function useLaneCount() {
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches)
  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY)
    const onChange = (event) => setMobile(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  return mobile ? 6 : 9
}

// Interleave sources so library words, chat words and wall words mix evenly.
function interleave(...sources) {
  const result = []
  const max = Math.max(...sources.map((source) => source.length), 0)
  for (let i = 0; i < max; i += 1) {
    sources.forEach((source) => {
      if (i < source.length) result.push(source[i])
    })
  }
  return result
}

function spread(words, laneIndex, laneCount) {
  const lane = []
  for (let i = laneIndex; i < words.length; i += laneCount) {
    lane.push(words[i])
  }
  return lane
}

export default function LiveWallBackground({ messages, chatWords, settings }) {
  const laneCount = useLaneCount()
  // One random sample per mount: the matrix differs between visits but does
  // not reshuffle on every re-render.
  const [librarySeed] = useState(() => Math.floor(Math.random() * 2 ** 31))
  const lanes = useMemo(() => {
    const wallWords = messages.flatMap((message) => message.text.match(/\S{1,24}/gu) || [])
    const libraryWords = sampleLibraryWords(180, librarySeed)
    const pool = interleave(libraryWords, [...wallWords, ...(chatWords || [])])
    return Array.from({ length: laneCount }, (_, index) => spread(pool, index, laneCount)).filter(
      (lane) => lane.length >= 3,
    )
  }, [chatWords, laneCount, librarySeed, messages])

  if (!settings?.enabled || !lanes.length) return null

  return (
    <div
      className="live-wall-background"
      aria-hidden="true"
      style={{ '--live-wall-opacity': settings.opacity }}
    >
      {lanes.map((lane, laneIndex) => (
        <div
          className={`live-wall-lane ${laneIndex % 2 ? 'reverse' : ''}`}
          key={laneIndex}
          style={{
            '--lane-top': `${((laneIndex + 0.5) / lanes.length) * 100}%`,
            '--lane-duration': `${(42 + (laneIndex % 4) * 9) / (settings.speed || 1)}s`,
            '--lane-delay': `${-(laneIndex * 7)}s`,
          }}
        >
          <div className="live-wall-track">
            {[0, 1].map((copy) => (
              <div className="live-wall-phrase" key={copy}>
                {lane.map((word, wordIndex) => (
                  <span className="live-wall-word" key={`${copy}-${wordIndex}`}>
                    {word}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
