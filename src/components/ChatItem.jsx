import { Archive, BellOff, MoreVertical, Pin } from 'lucide-react'
import Avatar from './Avatar'
import { formatChatTime } from '../utils/formatters'

export default function ChatItem({ chat, selected, onSelect, onTogglePin, onToggleMute, onArchive }) {
  const { contact } = chat
  const typeLabel = contact.type === 'group' ? 'group' : contact.type === 'channel' ? 'channel' : contact.type === 'bot' ? 'bot' : ''

  return (
    <article className={`chat-item ${selected ? 'selected' : ''}`} onClick={onSelect}>
      <Avatar contact={contact} />
      <div className="chat-item-body">
        <div className="chat-item-top">
          <strong>{contact.name}</strong>
          {typeLabel && <span className={`type-badge type-${contact.type}`}>{typeLabel}</span>}
          <time>{formatChatTime(chat.lastMessageTime)}</time>
        </div>
        <div className="chat-status-line">
          <span className={contact.status === 'online' ? 'online-text' : ''}>{contact.lastSeen}</span>
        </div>
        <div className="chat-item-bottom">
          <p>{chat.lastMessageText || 'No messages yet'}</p>
          <div className="chat-flags">
            {chat.pinned && <Pin size={13} />}
            {chat.muted && <BellOff size={13} />}
            {chat.unread > 0 && <span className="unread-badge">{chat.unread}</span>}
          </div>
        </div>
      </div>
      <div className="chat-row-actions" onClick={(event) => event.stopPropagation()}>
        <button onClick={onTogglePin} title={chat.pinned ? 'Unpin' : 'Pin'}>
          <Pin size={14} />
        </button>
        <button onClick={onToggleMute} title={chat.muted ? 'Unmute' : 'Mute'}>
          <BellOff size={14} />
        </button>
        <button onClick={onArchive} title={chat.archived ? 'Unarchive' : 'Archive'}>
          <Archive size={14} />
        </button>
        <button title="More options" style={{ pointerEvents: 'none', opacity: 0.5 }}>
          <MoreVertical size={14} />
        </button>
      </div>
    </article>
  )
}
