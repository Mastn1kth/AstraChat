import { useEffect, useRef, useState } from 'react'
import { Hash, Loader2, MessageSquare, Search, User, X } from 'lucide-react'
import { searchEverything } from '../api/client'
import { formatChatTime } from '../utils/formatters'
import Avatar from './Avatar'

function HighlightMatch({ text, query }) {
  if (!query || !text) return text || null
  const source = String(text)
  const lower = source.toLowerCase()
  const q = query.toLowerCase()
  const parts = []
  let cursor = 0
  let idx = lower.indexOf(q)
  while (idx !== -1) {
    if (idx > cursor) parts.push({ text: source.slice(cursor, idx), matched: false })
    parts.push({ text: source.slice(idx, idx + q.length), matched: true })
    cursor = idx + q.length
    idx = lower.indexOf(q, cursor)
  }
  if (cursor < source.length) parts.push({ text: source.slice(cursor), matched: false })
  return parts.map((part, i) =>
    part.matched
      ? <mark key={i} className="gs-match">{part.text}</mark>
      : <span key={i}>{part.text}</span>,
  )
}

export default function GlobalSearchPanel({ onClose, onSelectChat, onJumpToMessage, contacts = [] }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef(null)
  const debounceRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    clearTimeout(debounceRef.current)
    const q = query.trim()
    debounceRef.current = setTimeout(async () => {
      if (!q) { setResults(null); setLoading(false); return }
      setLoading(true)
      try {
        const data = await searchEverything(q)
        setResults(data)
      } catch {
        setResults({ users: [], chats: [], messages: [] })
      } finally {
        setLoading(false)
      }
    }, q ? 300 : 0)
    return () => clearTimeout(debounceRef.current)
  }, [query])

  const hasResults = results && (results.users?.length || results.chats?.length || results.messages?.length)

  function chatLabel(result) {
    if (result.type === 'private') {
      const contact = contacts.find((c) => c.id === result.id)
      return contact?.name || result.title || 'Private Chat'
    }
    return result.title || (result.type === 'channel' ? 'Channel' : 'Group')
  }

  function msgChatLabel(result) {
    if (result.chatType === 'private') return 'Private chat'
    return result.chatTitle || 'Group'
  }

  return (
    <div className="gs-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="gs-panel">
        <div className="gs-header">
          <Search size={16} className="gs-icon" />
          <input
            ref={inputRef}
            className="gs-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people, chats, messages…"
            autoComplete="off"
          />
          {loading && <Loader2 size={15} className="gs-spinner" />}
          <button className="gs-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="gs-body">
          {!query.trim() && (
            <p className="gs-hint">Type to search across all chats and contacts</p>
          )}

          {query.trim() && !loading && !hasResults && results && (
            <p className="gs-empty">No results for "{query}"</p>
          )}

          {results?.users?.length > 0 && (
            <section className="gs-section">
              <h4 className="gs-section-title"><User size={13} /> People</h4>
              {results.users.map((user) => (
                <button
                  key={user.id}
                  className="gs-row"
                  onClick={() => { onSelectChat?.(user); onClose() }}
                >
                  <Avatar name={user.name} src={user.avatar} size={34} />
                  <div className="gs-row-body">
                    <strong><HighlightMatch text={user.name} query={query} /></strong>
                    {user.username && <small>@<HighlightMatch text={user.username} query={query} /></small>}
                  </div>
                </button>
              ))}
            </section>
          )}

          {results?.chats?.length > 0 && (
            <section className="gs-section">
              <h4 className="gs-section-title"><Hash size={13} /> Chats & Groups</h4>
              {results.chats.map((chat) => (
                <button
                  key={chat.id}
                  className="gs-row"
                  onClick={() => { onSelectChat?.(chat); onClose() }}
                >
                  <Avatar name={chatLabel(chat)} size={34} />
                  <div className="gs-row-body">
                    <strong><HighlightMatch text={chatLabel(chat)} query={query} /></strong>
                    <small>{chat.type === 'channel' ? 'Channel' : chat.type === 'group' ? 'Group' : 'Chat'}</small>
                  </div>
                </button>
              ))}
            </section>
          )}

          {results?.messages?.length > 0 && (
            <section className="gs-section">
              <h4 className="gs-section-title"><MessageSquare size={13} /> Messages</h4>
              {results.messages.map((msg) => (
                <button
                  key={msg.id}
                  className="gs-row gs-msg-row"
                  onClick={() => { onJumpToMessage?.(msg.chatId, msg.id); onClose() }}
                >
                  <div className="gs-row-body">
                    <div className="gs-msg-meta">
                      <strong>{msgChatLabel(msg)}</strong>
                      <time>{formatChatTime(msg.createdAt)}</time>
                    </div>
                    <span className="gs-msg-text">
                      <HighlightMatch text={msg.searchText || msg.text} query={query} />
                    </span>
                  </div>
                </button>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
