import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Send, Trash2, X } from 'lucide-react'
import Avatar from './Avatar'
import { deleteStory, viewStory, reactToStory, replyToStory } from '../api/client'
import { formatChatTime } from '../utils/formatters'

const STORY_REACTIONS = ['❤️', '🔥', '😂', '😮', '👍', '🎉']

const STORY_DURATION = 5000

export default function StoryViewer({
  groups,
  initialGroupIndex = 0,
  currentUserId,
  onClose,
  onDeleted,
  onReplySent,
}) {
  const [groupIndex, setGroupIndex] = useState(initialGroupIndex)
  const [storyIndex, setStoryIndex] = useState(0)
  const [progress, setProgress] = useState(0)
  // Overrides after user reacts (keyed by storyId); falls back to story.reactions from server
  const [reactOverrides, setReactOverrides] = useState({})
  const [replyDraft, setReplyDraft] = useState({ storyId: null, text: '', status: '' })
  const [sendingReply, setSendingReply] = useState(false)
  const pausedRef = useRef(false)
  const timerRef = useRef(null)
  const startRef = useRef(null)
  const elapsedRef = useRef(0)

  const group = groups[groupIndex]
  const story = group?.stories[storyIndex]
  const replyText = replyDraft.storyId === story?.id ? replyDraft.text : ''
  const replyStatus = replyDraft.storyId === story?.id ? replyDraft.status : ''

  const advance = useCallback(() => {
    setGroupIndex((gi) => {
      const currentGroup = groups[gi]
      setStoryIndex((si) => {
        if (si + 1 < currentGroup.stories.length) return si + 1
        if (gi + 1 < groups.length) {
          setGroupIndex(gi + 1)
          return 0
        }
        onClose()
        return si
      })
      return gi
    })
    setProgress(0)
    elapsedRef.current = 0
  }, [groups, onClose])

  // Timer — runs when storyIndex/groupIndex changes
  useEffect(() => {
    elapsedRef.current = 0
    clearInterval(timerRef.current)
    startRef.current = Date.now()
    timerRef.current = setInterval(() => {
      if (pausedRef.current) return
      const elapsed = elapsedRef.current + (Date.now() - (startRef.current || Date.now()))
      const pct = Math.min(100, (elapsed / STORY_DURATION) * 100)
      setProgress(pct)
      if (pct >= 100) {
        clearInterval(timerRef.current)
        advance()
      }
    }, 50)
    return () => clearInterval(timerRef.current)
  }, [storyIndex, groupIndex, advance])

  useEffect(() => {
    if (!story?.id) return
    viewStory(story.id).catch(() => {})
  }, [story?.id])

  async function handleReact(emoji) {
    if (!story?.id) return
    const current = reactOverrides[story.id] || { reactions: story.reactions || {}, myReaction: story.myReaction || null }
    const next = current.myReaction === emoji ? '' : emoji
    try {
      const result = await reactToStory(story.id, next)
      setReactOverrides((prev) => ({
        ...prev,
        [story.id]: { reactions: result.reactions, myReaction: result.myReaction },
      }))
    } catch { /* ignore */ }
  }

  async function handleReply(event) {
    event.preventDefault()
    if (!story?.id || sendingReply) return
    const text = replyText.trim()
    if (!text) return
    setSendingReply(true)
    setReplyDraft({ storyId: story.id, text: replyText, status: '' })
    try {
      const result = await replyToStory(story.id, text)
      onReplySent?.(result)
      setReplyDraft({ storyId: story.id, text: '', status: 'Sent' })
    } catch (error) {
      setReplyDraft({ storyId: story.id, text: replyText, status: error?.message || 'Could not send' })
    } finally {
      setSendingReply(false)
    }
  }

  function setPaused(next) {
    if (next) {
      elapsedRef.current += Date.now() - (startRef.current || Date.now())
      pausedRef.current = true
    } else {
      startRef.current = Date.now()
      pausedRef.current = false
    }
  }

  function goPrev() {
    if (storyIndex > 0) {
      setStoryIndex((si) => si - 1)
    } else if (groupIndex > 0) {
      const prevGroup = groups[groupIndex - 1]
      setGroupIndex((gi) => gi - 1)
      setStoryIndex(prevGroup.stories.length - 1)
    }
    setProgress(0)
    elapsedRef.current = 0
  }

  function goNext() {
    advance()
  }

  async function handleDelete() {
    if (!story) return
    await deleteStory(story.id).catch(() => {})
    onDeleted?.(story.id, group.userId)
    onClose()
  }

  if (!group || !story) return null

  const isOwn = group.userId === currentUserId

  return (
    <div
      className="story-viewer"
      onMouseDown={() => setPaused(true)}
      onMouseUp={() => setPaused(false)}
      onTouchStart={() => setPaused(true)}
      onTouchEnd={() => setPaused(false)}
    >
      <div className="story-card" style={{ background: story.bgColor || '#7c3aed' }}>
        {/* Progress bars */}
        <div className="story-progress-row">
          {group.stories.map((s, i) => (
            <div key={s.id} className="story-progress-track">
              <div
                className="story-progress-fill"
                style={{
                  width: i < storyIndex ? '100%' : i === storyIndex ? `${progress}%` : '0%',
                }}
              />
            </div>
          ))}
        </div>

        {/* Header */}
        <div className="story-header">
          <Avatar contact={{ name: group.name, avatar: group.avatar }} size={36} />
          <div className="story-header-info">
            <strong>{group.name}</strong>
            <span>{formatChatTime(new Date(story.createdAt))}</span>
          </div>
          {isOwn && (
            <button className="story-delete-btn" onClick={handleDelete} title="Delete story">
              <Trash2 size={16} />
            </button>
          )}
          <button className="story-close-btn" onClick={onClose} title="Close">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="story-content">
          {story.mediaUrl && story.mediaKind === 'image' && (
            <img className="story-image" src={story.mediaUrl} alt="" />
          )}
          {story.text && <p className="story-text">{story.text}</p>}
        </div>

        {/* Reaction bar */}
        {!isOwn && (
          <>
            <div className="story-reactions" onMouseDown={(e) => e.stopPropagation()} onTouchStart={(e) => e.stopPropagation()}>
              {STORY_REACTIONS.map((emoji) => {
                const data = reactOverrides[story.id] || { reactions: story.reactions || {}, myReaction: story.myReaction || null }
                const count = (data.reactions || {})[emoji] || 0
                const active = data.myReaction === emoji
                return (
                  <button
                    key={emoji}
                    className={`story-react-btn ${active ? 'active' : ''}`}
                    onClick={(e) => { e.stopPropagation(); handleReact(emoji) }}
                  >
                    {emoji}{count > 0 && <span>{count}</span>}
                  </button>
                )
              })}
            </div>
            <form
              className="story-reply"
              onSubmit={handleReply}
              onMouseDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
            >
              <input
                value={replyText}
                onChange={(e) => setReplyDraft({ storyId: story.id, text: e.target.value, status: '' })}
                onFocus={() => setPaused(true)}
                onBlur={() => setPaused(false)}
                placeholder="Reply to story"
                maxLength={2000}
              />
              <button type="submit" disabled={!replyText.trim() || sendingReply} title="Send reply">
                <Send size={16} />
              </button>
              {replyStatus && <span>{replyStatus}</span>}
            </form>
          </>
        )}
        {isOwn && Object.keys((reactOverrides[story.id]?.reactions || story.reactions) || {}).length > 0 && (
          <div className="story-reactions story-reactions-owner">
            {Object.entries(reactOverrides[story.id]?.reactions || story.reactions || {}).map(([emoji, count]) => (
              <span key={emoji} className="story-react-count">{emoji} {count}</span>
            ))}
          </div>
        )}

        {/* Nav zones */}
        <button className="story-nav story-nav-prev" onClick={(e) => { e.stopPropagation(); goPrev() }}>
          <ChevronLeft size={28} />
        </button>
        <button className="story-nav story-nav-next" onClick={(e) => { e.stopPropagation(); goNext() }}>
          <ChevronRight size={28} />
        </button>
      </div>

      {/* Group switcher dots */}
      {groups.length > 1 && (
        <div className="story-group-dots">
          {groups.map((g, i) => (
            <button
              key={g.userId}
              className={`story-group-dot ${i === groupIndex ? 'active' : ''}`}
              onClick={() => {
                setGroupIndex(i)
                setStoryIndex(0)
                setProgress(0)
                elapsedRef.current = 0
              }}
            />
          ))}
        </div>
      )}

      <button className="story-scrim" onClick={onClose} />
    </div>
  )
}
