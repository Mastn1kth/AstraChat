import { Check, CheckCheck, Copy, Download, Edit3, FileText, Forward, Mic, Play, Reply, SmilePlus, Trash2 } from 'lucide-react'
import { formatMessageTime } from '../utils/formatters'

const reactions = ['\u{1F44D}', '\u{1F499}', '\u{1F602}', '\u{1F525}']

function formatDuration(durationMs) {
  if (!durationMs || durationMs < 0) return ''
  const totalSeconds = Math.round(durationMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function formatFileSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function StatusIcon({ status }) {
  if (status === 'sending') return <span className="sending-dot" />
  if (status === 'sent') return <Check size={14} />
  if (status === 'delivered') return <CheckCheck size={14} />
  if (status === 'failed') return <span className="failed-status">!</span>
  return <CheckCheck size={14} className="read-check" />
}

export default function MessageBubble({
  message,
  replyMessage,
  sender,
  isOwn,
  selected,
  matched,
  highlighted,
  onJumpToReply,
  onSelect,
  onStartReply,
  onStartEdit,
  onDelete,
  onCopy,
  onReact,
  onOpenMedia,
  onForward,
}) {
  const reactionEntries = Object.entries(message.reactions || {}).filter(([, count]) => count > 0)

  return (
    <div className={`message-row ${isOwn ? 'own' : 'incoming'} ${selected ? 'selected' : ''}`}>
      <div
        className={`message-bubble ${matched ? 'matched' : ''} ${highlighted ? 'flash' : ''}`}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') onSelect()
        }}
        role="button"
        tabIndex={0}
      >
        {replyMessage && (
          <button
            type="button"
            className="reply-snippet"
            onClick={(event) => {
              event.stopPropagation()
              onJumpToReply?.(replyMessage.id)
            }}
          >
            <strong>{replyMessage.senderName ?? (replyMessage.senderId === sender.id ? sender.name : 'You')}</strong>
            <small>{replyMessage.text || 'Media message'}</small>
          </button>
        )}
        {message.media && !message.deleted && message.media.decryptFailed && (
          <button className="message-media" disabled aria-label="Encrypted media unavailable">
            <span className="message-media-failed">Encrypted media unavailable</span>
          </button>
        )}
        {message.media && !message.deleted && !message.media.decryptFailed && (
          message.media.kind === 'voice' ? (
            <div className="message-voice" onClick={(event) => event.stopPropagation()}>
              <span className="message-voice-icon">
                <Mic size={16} />
              </span>
              <audio src={message.media.url} controls preload="metadata" />
              {message.media.durationMs ? (
                <span className="message-voice-time">{formatDuration(message.media.durationMs)}</span>
              ) : null}
            </div>
          ) : message.media.kind === 'file' ? (
            <a
              className="message-file"
              href={message.media.url}
              download={message.media.name || 'file'}
              onClick={(event) => event.stopPropagation()}
            >
              <span className="message-file-icon">
                <FileText size={20} />
              </span>
              <span className="message-file-body">
                <strong>{message.media.name || 'File'}</strong>
                <small>{formatFileSize(message.media.size)}</small>
              </span>
              <span className="message-file-download">
                <Download size={18} />
              </span>
            </a>
          ) : (
            <button
              className={`message-media ${message.media.kind}`}
              onClick={(event) => {
                event.stopPropagation()
                onOpenMedia(message.media)
              }}
              aria-label={`Open ${message.media.kind}`}
            >
              {message.media.kind === 'image' ? (
                <img src={message.media.url} alt={message.media.name || 'Shared photo'} loading="lazy" />
              ) : (
                <>
                  <video src={message.media.url} preload="metadata" muted />
                  <span className="media-play">
                    <Play size={22} fill="currentColor" />
                  </span>
                </>
              )}
            </button>
          )
        )}
        {message.deleted ? (
          <em className="deleted-message">Message deleted</em>
        ) : message.text ? (
          <>
            {message.forwarded && <small className="forwarded-label">Forwarded</small>}
            <span className="message-text">{message.text}</span>
          </>
        ) : null}
        <span className="message-meta">
          {message.mock && <small>mock</small>}
          {message.edited && <small>edited</small>}
          <time>{formatMessageTime(message.time)}</time>
          {isOwn && <StatusIcon status={message.status} />}
        </span>
      </div>

      {reactionEntries.length > 0 && (
        <div className={`reaction-strip ${isOwn ? 'align-right' : ''}`}>
          {reactionEntries.map(([emoji, count]) => (
            <button key={emoji} onClick={() => onReact(emoji)}>
              {emoji} {count}
            </button>
          ))}
        </div>
      )}

      {selected && !message.deleted && (
        <div className={`message-context ${isOwn ? 'context-own' : ''}`}>
          <button onClick={onStartReply}>
            <Reply size={15} /> Reply
          </button>
          <button onClick={onCopy}>
            <Copy size={15} /> Copy
          </button>
          <button onClick={() => onReact('\u{1F44D}')}>
            <SmilePlus size={15} /> React
          </button>
          <button onClick={onForward}>
            <Forward size={15} /> Forward
          </button>
          {isOwn && (
            <button onClick={onStartEdit}>
              <Edit3 size={15} /> Edit
            </button>
          )}
          <button className="danger" onClick={onDelete}>
            <Trash2 size={15} /> Delete
          </button>
          <div className="quick-reactions">
            {reactions.map((emoji) => (
              <button key={emoji} onClick={() => onReact(emoji)}>
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
