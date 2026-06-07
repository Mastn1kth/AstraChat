import { Search, X } from 'lucide-react'
import { formatChatTime } from '../utils/formatters'

export default function SearchPanel({ query, messages, contact, currentUser, onQuery, onClose, onSelect }) {
  const normalized = query.trim().toLowerCase()
  const results = normalized
    ? messages.filter((message) => !message.deleted && message.text?.toLowerCase().includes(normalized))
    : []

  return (
    <aside className="side-panel search-panel">
      <header>
        <strong>Search messages</strong>
        <button onClick={onClose} aria-label="Close search">
          <X size={20} />
        </button>
      </header>
      <label className="search-field">
        <Search size={17} />
        <input
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          autoFocus
          placeholder="Text inside this chat"
        />
      </label>
      <div className="panel-list">
        {!normalized && <p className="panel-empty">Type to search inside this chat.</p>}
        {normalized && !results.length && <p className="panel-empty">Nothing found in this conversation.</p>}
        {results.map((message) => (
          <button key={message.id} onClick={() => onSelect(message.id)}>
            <span>{message.senderId === currentUser.id ? 'You' : contact.name}</span>
            <small>{formatChatTime(message.time)}</small>
            <p>{message.text}</p>
          </button>
        ))}
      </div>
    </aside>
  )
}
