import { Archive, BellOff, Pin } from 'lucide-react'
import Avatar from './Avatar'
import { formatChatTime } from '../utils/formatters'
import { t } from '../i18n'

export default function ChatItem({
  chat,
  selected,
  canPinInFolder,
  onSelect,
  onTogglePin,
  onToggleMute,
  onArchive,
  onToggleFolderPin,
}) {
  const { contact } = chat
  const typeLabel = contact.type === 'group' ? 'group' : contact.type === 'channel' ? 'channel' : ''

  const statusBits = []
  if (chat.pinned) statusBits.push('pinned')
  if (chat.muted) statusBits.push('muted')
  if (chat.unread > 0) statusBits.push(`${chat.unread} unread`)
  if (chat.mentions > 0) statusBits.push('mentioned you')
  const stateSummary = statusBits.join(', ')
  const rowLabel = [contact.name, typeLabel, stateSummary].filter(Boolean).join(', ')

  return (
    <article
      className={`chat-item ${selected ? 'selected' : ''}`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      aria-label={rowLabel}
      aria-current={selected ? 'true' : undefined}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
    >
      <Avatar contact={contact} />
      <div className="chat-item-body">
        <div className="chat-item-top">
          <strong>{contact.name}</strong>
          {typeLabel && <span className={`type-badge type-${contact.type}`}>{typeLabel}</span>}
          <time>{formatChatTime(chat.lastMessageTime)}</time>
        </div>
        <div className="chat-status-line">
          {contact.customStatus ? (
            <>
              <span className="custom-status-text">{contact.customStatus}</span>
              {contact.lastSeen && <span className={contact.status === 'online' ? 'online-text' : ''}>{contact.lastSeen}</span>}
            </>
          ) : (
            <span className={contact.status === 'online' ? 'online-text' : ''}>{contact.lastSeen}</span>
          )}
        </div>
        <div className="chat-item-bottom">
          <p>{chat.lastMessageText || t('chat.noMessages')}</p>
          <div className="chat-flags" aria-hidden="true">
            {chat.folderPinned && <Pin size={13} className="folder-pin-flag" />}
            {chat.pinned && <Pin size={13} />}
            {chat.muted && <BellOff size={13} />}
            {chat.mentions > 0 && <span className="mention-badge">@</span>}
            {chat.unread > 0 && <span className={`unread-badge${chat.muted ? ' muted' : ''}`}>{chat.unread}</span>}
          </div>
        </div>
      </div>
      <div className="chat-row-actions" onClick={(event) => event.stopPropagation()}>
        {canPinInFolder && (
          <button
            type="button"
            onClick={onToggleFolderPin}
            title={chat.folderPinned ? t('chat.unpinInFolder') : t('chat.pinInFolder')}
            aria-label={chat.folderPinned ? t('chat.unpinInFolder') : t('chat.pinInFolder')}
            className={chat.folderPinned ? 'active' : ''}
          >
            <Pin size={14} />
          </button>
        )}
        <button
          type="button"
          onClick={onTogglePin}
          title={chat.pinned ? t('chat.unpin') : t('chat.pin')}
          aria-label={chat.pinned ? t('chat.unpin') : t('chat.pin')}
        >
          <Pin size={14} />
        </button>
        <button
          type="button"
          onClick={onToggleMute}
          title={chat.muted ? t('chat.unmute') : t('chat.mute')}
          aria-label={chat.muted ? t('chat.unmute') : t('chat.mute')}
        >
          <BellOff size={14} />
        </button>
        <button
          type="button"
          onClick={onArchive}
          title={chat.archived ? t('chat.unarchive') : t('chat.archive')}
          aria-label={chat.archived ? t('chat.unarchive') : t('chat.archive')}
        >
          <Archive size={14} />
        </button>
      </div>
    </article>
  )
}
