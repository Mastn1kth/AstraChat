import { useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import Avatar from './Avatar'
import { createStory, getStories } from '../api/client'

const BG_COLORS = [
  '#7c3aed', '#6d28d9', '#4f46e5', '#0891b2', '#0f766e',
  '#15803d', '#b45309', '#b91c1c', '#9d174d', '#1d4ed8',
]

export default function StoriesBar({ currentUser, onOpenViewer }) {
  const [groups, setGroups] = useState([])
  const [composing, setComposing] = useState(false)
  const [storyText, setStoryText] = useState('')
  const [bgColor, setBgColor] = useState(BG_COLORS[0])
  const [sending, setSending] = useState(false)
  const textRef = useRef(null)

  useEffect(() => {
    getStories()
      .then((data) => setGroups(data.stories || []))
      .catch(() => {})
  }, [])

  const ownGroup = groups.find((g) => g.userId === currentUser?.id)

  async function submitStory() {
    const text = storyText.trim()
    if (!text || sending) return
    setSending(true)
    try {
      await createStory({ text, bgColor })
      setStoryText('')
      setComposing(false)
      const data = await getStories()
      setGroups(data.stories || [])
    } catch {
      // ignore
    } finally {
      setSending(false)
    }
  }

  function handleStoryDeleted(storyId, userId) {
    setGroups((prev) => prev
      .map((g) => g.userId !== userId ? g : { ...g, stories: g.stories.filter((s) => s.id !== storyId) })
      .filter((g) => g.stories.length > 0),
    )
  }

  if (composing) {
    return (
      <div className="story-compose">
        <div className="story-compose-preview" style={{ background: bgColor }}>
          <textarea
            ref={textRef}
            className="story-compose-input"
            placeholder="What's on your mind?"
            maxLength={500}
            value={storyText}
            onChange={(e) => setStoryText(e.target.value)}
            autoFocus
          />
        </div>
        <div className="story-compose-colors">
          {BG_COLORS.map((color) => (
            <button
              key={color}
              className={`story-color-dot ${color === bgColor ? 'active' : ''}`}
              style={{ background: color }}
              onClick={() => setBgColor(color)}
            />
          ))}
        </div>
        <div className="story-compose-actions">
          <button onClick={() => setComposing(false)} disabled={sending}>
            <X size={14} /> Cancel
          </button>
          <button
            className="primary-button"
            onClick={submitStory}
            disabled={!storyText.trim() || sending}
          >
            {sending ? 'Posting…' : 'Post story'}
          </button>
        </div>
      </div>
    )
  }

  if (!groups.length) return null

  const ordered = [
    ...groups.filter((g) => g.userId !== currentUser?.id && g.hasUnviewed),
    ...groups.filter((g) => g.userId !== currentUser?.id && !g.hasUnviewed),
  ]
  if (ownGroup) ordered.unshift(ownGroup)

  return (
    <div className="stories-bar">
      {/* Own story / add button */}
      <button
        className={`story-ring story-ring-own ${ownGroup ? 'has-story' : ''}`}
        title={ownGroup ? 'Your story' : 'Add story'}
        onClick={() => {
          if (ownGroup) {
            const idx = ordered.findIndex((g) => g.userId === currentUser?.id)
            onOpenViewer(ordered, Math.max(0, idx), handleStoryDeleted)
          } else {
            setComposing(true)
          }
        }}
      >
        <Avatar contact={currentUser} size={46} />
        {!ownGroup && (
          <span className="story-add-badge"><Plus size={11} /></span>
        )}
      </button>

      {/* Contact stories */}
      {ordered.filter((g) => g.userId !== currentUser?.id).map((group) => {
        const idx = ordered.indexOf(group)
        return (
          <button
            key={group.userId}
            className={`story-ring ${group.hasUnviewed ? 'unviewed' : 'viewed'}`}
            title={group.name}
            onClick={() => onOpenViewer(ordered, idx, handleStoryDeleted)}
          >
            <Avatar contact={{ name: group.name, avatar: group.avatar }} size={46} />
            <span className="story-name">{group.name.split(' ')[0]}</span>
          </button>
        )
      })}
    </div>
  )
}
