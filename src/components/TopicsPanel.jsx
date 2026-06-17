import { useCallback, useEffect, useState } from 'react'
import { Hash, Lock, Pin, Plus, RefreshCw, X } from 'lucide-react'
import { getChatTopics, createChatTopic, updateChatTopic } from '../api/client'

function formatRelativeTime(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default function TopicsPanel({
  chatId,
  activeTopic,
  currentMemberRole,
  onSelectTopic,
  onClose,
}) {
  const [topics, setTopics] = useState(null)
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [error, setError] = useState('')

  const canManage = ['owner', 'admin', 'moderator'].includes(currentMemberRole)

  const load = useCallback(async () => {
    if (!chatId) return
    setLoading(true)
    setError('')
    try {
      const data = await getChatTopics(chatId)
      setTopics(data.topics || [])
    } catch (err) {
      setError(err.message || 'Failed to load topics')
    } finally {
      setLoading(false)
    }
  }, [chatId])

  useEffect(() => {
    const timer = window.setTimeout(() => { load() }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  async function handleCreate(e) {
    e.preventDefault()
    const title = newTitle.trim()
    if (!title) return
    try {
      const data = await createChatTopic(chatId, { title })
      setTopics((current) => [data.topic, ...(current || [])])
      setNewTitle('')
      setCreating(false)
    } catch (err) {
      setError(err.message || 'Failed to create topic')
    }
  }

  async function togglePin(topic) {
    if (!canManage) return
    try {
      await updateChatTopic(chatId, topic.id, { pinned: !topic.pinned })
      setTopics((current) =>
        (current || []).map((t) => t.id === topic.id ? { ...t, pinned: !t.pinned } : t),
      )
    } catch (err) {
      setError(err.message || 'Failed to update topic')
    }
  }

  async function toggleClosed(topic) {
    if (!canManage) return
    try {
      await updateChatTopic(chatId, topic.id, { closed: !topic.closed })
      setTopics((current) =>
        (current || []).map((t) => t.id === topic.id ? { ...t, closed: !t.closed } : t),
      )
    } catch (err) {
      setError(err.message || 'Failed to update topic')
    }
  }

  const sorted = (topics || []).slice().sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    const aTime = a.lastMessageAt || a.createdAt || ''
    const bTime = b.lastMessageAt || b.createdAt || ''
    return bTime.localeCompare(aTime)
  })

  return (
    <aside className="side-panel topics-panel">
      <header className="topics-panel-header">
        <strong><Hash size={16} /> Topics</strong>
        <div style={{ display: 'flex', gap: 4 }}>
          {canManage && (
            <button
              onClick={() => setCreating((v) => !v)}
              aria-label="New topic"
              title="New topic"
            >
              <Plus size={16} />
            </button>
          )}
          <button onClick={load} aria-label="Refresh" disabled={loading}>
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
          </button>
          <button onClick={onClose} aria-label="Close topics">
            <X size={18} />
          </button>
        </div>
      </header>

      {creating && (
        <form className="topic-create-form" onSubmit={handleCreate}>
          <input
            autoFocus
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Topic name…"
            maxLength={64}
          />
          <button type="submit" className="primary-button" disabled={!newTitle.trim()}>
            Create
          </button>
          <button type="button" onClick={() => setCreating(false)}>Cancel</button>
        </form>
      )}

      {error && <p className="shared-empty" style={{ color: 'var(--danger)', padding: '8px 16px' }}>{error}</p>}

      <div className="topics-list">
        {/* "All messages" row */}
        <button
          className={`topic-row ${!activeTopic ? 'active' : ''}`}
          onClick={() => onSelectTopic(null)}
        >
          <span className="topic-icon"><Hash size={14} /></span>
          <span className="topic-body">
            <strong>All messages</strong>
            <small>Show all messages in this group</small>
          </span>
        </button>

        {!topics && loading && (
          <p className="shared-empty">Loading…</p>
        )}
        {topics?.length === 0 && !loading && (
          <p className="shared-empty">No topics yet{canManage ? ' — create one above' : ''}</p>
        )}

        {sorted.map((topic) => (
          <button
            key={topic.id}
            className={`topic-row ${activeTopic?.id === topic.id ? 'active' : ''} ${topic.closed ? 'closed' : ''}`}
            onClick={() => onSelectTopic(topic)}
          >
            <span className="topic-icon">
              {topic.closed ? <Lock size={14} /> : <Hash size={14} />}
            </span>
            <span className="topic-body">
              <strong>
                {topic.title}
                {topic.pinned && <Pin size={11} className="topic-pin-badge" />}
              </strong>
              <small>
                {topic.messageCount > 0
                  ? `${topic.messageCount} msg${topic.messageCount !== 1 ? 's' : ''}`
                  : 'No messages'}
                {topic.lastMessageAt ? ` · ${formatRelativeTime(topic.lastMessageAt)}` : ''}
              </small>
            </span>
            {canManage && (
              <span className="topic-admin-actions" onClick={(e) => e.stopPropagation()}>
                <button
                  className={topic.pinned ? 'topic-admin-active' : ''}
                  title={topic.pinned ? 'Unpin' : 'Pin'}
                  onClick={() => togglePin(topic)}
                >
                  <Pin size={12} />
                </button>
                <button
                  className={topic.closed ? 'topic-admin-active' : ''}
                  title={topic.closed ? 'Reopen' : 'Close'}
                  onClick={() => toggleClosed(topic)}
                >
                  <Lock size={12} />
                </button>
              </span>
            )}
          </button>
        ))}
      </div>
    </aside>
  )
}
