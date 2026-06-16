import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, Clock3, Search, Users, X } from 'lucide-react'
import { searchChatMessages } from '../api/client'
import { formatChatTime } from '../utils/formatters'

const SEARCH_HISTORY_LIMIT = 8

function historyKey(chatId) {
  return `astrachat:search-history:${chatId || 'local'}`
}

function loadSearchHistory(chatId) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(historyKey(chatId)) || '[]')
    return Array.isArray(parsed) ? parsed.filter(Boolean).slice(0, SEARCH_HISTORY_LIMIT) : []
  } catch {
    return []
  }
}

function saveSearchHistory(chatId, values) {
  window.localStorage.setItem(historyKey(chatId), JSON.stringify(values.slice(0, SEARCH_HISTORY_LIMIT)))
}

function dateMatchesFilter(value, filter) {
  if (filter === 'all') return true
  const timestamp = new Date(value || 0).getTime()
  if (!Number.isFinite(timestamp)) return false
  const now = Date.now()
  const dayMs = 24 * 60 * 60 * 1000
  if (filter === 'today') {
    return new Date(timestamp).toDateString() === new Date(now).toDateString()
  }
  if (filter === 'week') return now - timestamp <= 7 * dayMs
  if (filter === 'month') return now - timestamp <= 30 * dayMs
  return true
}

function HighlightMatch({ text, query }) {
  if (!query) return text

  const source = String(text || '')
  const normalizedSource = source.toLowerCase()
  const parts = []
  let cursor = 0
  let index = normalizedSource.indexOf(query)

  while (index !== -1) {
    if (index > cursor) parts.push({ text: source.slice(cursor, index), matched: false })
    parts.push({ text: source.slice(index, index + query.length), matched: true })
    cursor = index + query.length
    index = normalizedSource.indexOf(query, cursor)
  }

  if (cursor < source.length) parts.push({ text: source.slice(cursor), matched: false })
  if (!parts.length) return source

  return parts.map((part, partIndex) =>
    part.matched ? (
      <mark key={`${part.text}-${partIndex}`} className="search-match">
        {part.text}
      </mark>
    ) : (
      <span key={`${part.text}-${partIndex}`}>{part.text}</span>
    ),
  )
}

export default function SearchPanel({
  query,
  messages,
  contact,
  contacts = [],
  currentUser,
  chat,
  onQuery,
  onClose,
  onSelect,
}) {
  const normalized = query.trim().toLowerCase()
  const chatId = chat?.id || ''
  const backendSearch = Boolean(chat?.backend && chatId)
  const [dateFilter, setDateFilter] = useState('all')
  const [senderFilter, setSenderFilter] = useState('all')
  const [historyState, setHistoryState] = useState(() => ({
    chatId,
    values: loadSearchHistory(chatId),
  }))
  const [serverSearch, setServerSearch] = useState({
    query: '',
    results: [],
    loading: false,
    error: '',
    limitedByEncryption: false,
  })
  const localResults = useMemo(
    () =>
      normalized
        ? messages.filter((message) => !message.deleted && message.text?.toLowerCase().includes(normalized))
        : [],
    [messages, normalized],
  )
  const activeServerSearch = serverSearch.query === normalized ? serverSearch : null
  const rawResults = useMemo(
    () => (backendSearch ? activeServerSearch?.results || [] : localResults),
    [activeServerSearch?.results, backendSearch, localResults],
  )
  const history = historyState.chatId === chatId ? historyState.values : loadSearchHistory(chatId)
  const senderOptions = useMemo(() => {
    const byId = new Map()
    function addSender(senderId) {
      if (!senderId || byId.has(senderId)) return
      const found = senderId === currentUser.id
        ? currentUser
        : contacts.find((item) => item.id === senderId)
      byId.set(senderId, found?.name || found?.username || (senderId === contact.id ? contact.name : 'Unknown sender'))
    }
    messages.forEach((message) => addSender(message.senderId))
    rawResults.forEach((message) => addSender(message.senderId))
    return [...byId.entries()].map(([id, name]) => ({ id, name: id === currentUser.id ? 'You' : name }))
  }, [contact.id, contact.name, contacts, currentUser, messages, rawResults])
  const results = useMemo(
    () =>
      rawResults.filter((message) => {
        const senderMatches = senderFilter === 'all' || message.senderId === senderFilter
        const dateMatches = dateMatchesFilter(message.time || message.createdAt, dateFilter)
        return senderMatches && dateMatches
      }),
    [dateFilter, rawResults, senderFilter],
  )
  const loading = Boolean(activeServerSearch?.loading)
  const error = activeServerSearch?.error || ''
  const limitedByEncryption = Boolean(activeServerSearch?.limitedByEncryption)

  function rememberSearch(value = normalized) {
    const clean = value.trim().toLowerCase()
    if (clean.length < 2) return
    setHistoryState((current) => {
      const currentValues = current.chatId === chatId ? current.values : loadSearchHistory(chatId)
      const next = [clean, ...currentValues.filter((item) => item !== clean)].slice(0, SEARCH_HISTORY_LIMIT)
      saveSearchHistory(chatId, next)
      return { chatId, values: next }
    })
  }

  function clearHistory() {
    saveSearchHistory(chatId, [])
    setHistoryState({ chatId, values: [] })
  }

  useEffect(() => {
    if (!backendSearch || !normalized) {
      return undefined
    }

    let active = true
    const timer = window.setTimeout(() => {
      setServerSearch({
        query: normalized,
        results: [],
        loading: true,
        error: '',
        limitedByEncryption: false,
      })
      searchChatMessages(chatId, normalized)
        .then((data) => {
          if (!active) return
          setServerSearch({
            query: normalized,
            results: data.messages || [],
            loading: false,
            error: '',
            limitedByEncryption: Boolean(data.messageSearchLimitedByEncryption),
          })
        })
        .catch((searchError) => {
          if (!active) return
          setServerSearch({
            query: normalized,
            results: [],
            loading: false,
            error: searchError.message || 'Search failed.',
            limitedByEncryption: false,
          })
        })
    }, 220)

    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [backendSearch, chatId, normalized])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setHistoryState({ chatId, values: loadSearchHistory(chatId) })
      setDateFilter('all')
      setSenderFilter('all')
    }, 0)
    return () => window.clearTimeout(timer)
  }, [chatId])

  useEffect(() => {
    if (!normalized || loading || error) return undefined
    const timer = window.setTimeout(() => rememberSearch(normalized), 700)
    return () => window.clearTimeout(timer)
    // rememberSearch intentionally reads the latest history through setState.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error, loading, normalized])

  return (
    <aside className="side-panel search-panel">
      <header>
        <strong>Search messages</strong>
        <button onClick={onClose} aria-label="Close search">
          <X size={20} />
        </button>
      </header>
      <form className="search-field" onSubmit={(event) => {
        event.preventDefault()
        rememberSearch()
      }}>
        <Search size={17} />
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          autoFocus
          placeholder="Text inside this chat"
        />
      </form>
      <div className="search-filters" aria-label="Search filters">
        <label>
          <CalendarDays size={14} />
          <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value)}>
            <option value="all">Any date</option>
            <option value="today">Today</option>
            <option value="week">Last 7 days</option>
            <option value="month">Last 30 days</option>
          </select>
        </label>
        <label>
          <Users size={14} />
          <select value={senderFilter} onChange={(event) => setSenderFilter(event.target.value)}>
            <option value="all">Any sender</option>
            {senderOptions.map((sender) => (
              <option key={sender.id} value={sender.id}>{sender.name}</option>
            ))}
          </select>
        </label>
      </div>
      {history.length > 0 && (
        <section className="search-history">
          <div>
            <strong><Clock3 size={14} /> Recent</strong>
            <button type="button" onClick={clearHistory}>Clear</button>
          </div>
          <div className="search-history-chips">
            {history.map((item) => (
              <button key={item} type="button" onClick={() => onQuery(item)}>
                {item}
              </button>
            ))}
          </div>
        </section>
      )}
      {backendSearch && (
        <p className="panel-note">
          Message search is limited to indexed text. Encrypted history without search text is not searchable on the server.
        </p>
      )}
      <div className="panel-list">
        {!normalized && <p className="panel-empty">Type to search inside this chat.</p>}
        {loading && <p className="panel-empty">Searching...</p>}
        {error && <p className="panel-empty">{error}</p>}
        {normalized && !loading && !error && !results.length && (
          <p className="panel-empty">
            Nothing found with these filters{limitedByEncryption ? ' within the searchable index' : ''}.
          </p>
        )}
        {results.map((message) => (
          <button key={message.id} onClick={() => onSelect(message.id)}>
            <span>{message.senderId === currentUser.id ? 'You' : contact.name}</span>
            <small>{formatChatTime(message.time || message.createdAt)}</small>
            <p>
              <HighlightMatch text={message.text || message.preview || 'Message'} query={normalized} />
            </p>
          </button>
        ))}
      </div>
    </aside>
  )
}
