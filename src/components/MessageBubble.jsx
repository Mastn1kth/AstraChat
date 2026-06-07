import { useEffect, useState } from 'react'
import { AlertCircle, Check, CheckCheck, CheckSquare, Copy, Download, Edit3, ExternalLink, FileText, Forward, Mic, Pin, Play, RefreshCw, Reply, SmilePlus, Square, Trash2 } from 'lucide-react'
import { formatMessageTime } from '../utils/formatters'
import FormattedText from '../utils/textFormat'
import { getLinkPreview } from '../api/client'

const URL_REGEX = /\bhttps?:\/\/[^\s<>"']+/g
const linkPreviewCache = new Map()

function extractFirstUrl(text) {
  if (!text) return null
  const match = text.match(URL_REGEX)
  return match ? match[0].replace(/[),.;!?]+$/, '') : null
}

function useLinkPreview(url) {
  const [loadedPreview, setLoadedPreview] = useState({ url: null, preview: null })

  useEffect(() => {
    if (!url || linkPreviewCache.has(url)) return undefined

    let cancelled = false
    getLinkPreview(url)
      .then((data) => {
        if (cancelled) return
        const result = (data?.title || data?.description) ? data : null
        linkPreviewCache.set(url, result)
        setLoadedPreview({ url, preview: result })
      })
      .catch(() => {
        if (cancelled) return
        linkPreviewCache.set(url, null)
        setLoadedPreview({ url, preview: null })
      })

    return () => { cancelled = true }
  }, [url])

  if (!url) return null
  if (linkPreviewCache.has(url)) return linkPreviewCache.get(url)
  return loadedPreview.url === url ? loadedPreview.preview : undefined
}

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
  if (status === 'failed') return <AlertCircle size={14} className="failed-icon" />
  return <CheckCheck size={14} className="read-check" />
}

function LinkPreviewCard({ url, preview }) {
  if (!preview) return null
  return (
    <a
      className="link-preview-card"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
    >
      {preview.image && (
        <img
          className="link-preview-image"
          src={preview.image}
          alt=""
          loading="lazy"
          onError={(e) => { e.currentTarget.style.display = 'none' }}
        />
      )}
      <div className="link-preview-body">
        {preview.siteName && <span className="link-preview-site">{preview.siteName}</span>}
        {preview.title && <strong className="link-preview-title">{preview.title}</strong>}
        {preview.description && <span className="link-preview-desc">{preview.description}</span>}
        <span className="link-preview-url">
          <ExternalLink size={11} />{' '}
          {(() => { try { return new URL(url).hostname } catch { return url } })()}
        </span>
      </div>
    </a>
  )
}

export default function MessageBubble({
  message,
  replyMessage,
  sender,
  isOwn,
  selected,
  matched,
  highlighted,
  multiSelectMode,
  multiSelected,
  onJumpToReply,
  onSelect,
  onStartReply,
  onStartEdit,
  onDelete,
  onCopy,
  onReact,
  onOpenMedia,
  onForward,
  onPin,
  onToggleSelect,
  onRetry,
}) {
  const reactionEntries = Object.entries(message.reactions || {}).filter(([, count]) => count > 0)
  const firstUrl = !message.deleted && message.text ? extractFirstUrl(message.text) : null
  const linkPreview = useLinkPreview(firstUrl)

  return (
    <div className={`message-row ${isOwn ? 'own' : 'incoming'} ${selected ? 'selected' : ''} ${multiSelectMode ? 'multi-select-mode' : ''} ${multiSelected ? 'multi-selected' : ''}`}>
      {multiSelectMode && (
        <button
          className={`message-select-checkbox ${multiSelected ? 'checked' : ''}`}
          onClick={(event) => { event.stopPropagation(); onToggleSelect() }}
          aria-label={multiSelected ? 'Deselect message' : 'Select message'}
        >
          {multiSelected ? <CheckSquare size={18} /> : <Square size={18} />}
        </button>
      )}

      <div
        className={`message-bubble ${matched ? 'matched' : ''} ${highlighted ? 'flash' : ''} ${message.status === 'failed' ? 'failed' : ''}`}
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
            <span className="message-text">
              <FormattedText text={message.text} />
            </span>
          </>
        ) : null}

        {linkPreview && <LinkPreviewCard url={firstUrl} preview={linkPreview} />}

        <span className="message-meta">
          {message.mock && <small>mock</small>}
          {message.edited && <small>edited</small>}
          <time>{formatMessageTime(message.time)}</time>
          {isOwn && <StatusIcon status={message.status} />}
          {isOwn && message.status === 'failed' && onRetry && (
            <button
              className="retry-button"
              onClick={(e) => { e.stopPropagation(); onRetry() }}
              title="Retry sending"
            >
              <RefreshCw size={12} />
            </button>
          )}
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

      {selected && !message.deleted && !multiSelectMode && (
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
          <button onClick={onToggleSelect}>
            <CheckSquare size={15} /> Select
          </button>
          {onPin && (
            <button onClick={onPin}>
              <Pin size={15} /> Pin
            </button>
          )}
          {isOwn && (
            <button onClick={onStartEdit}>
              <Edit3 size={15} /> Edit
            </button>
          )}
          {isOwn && message.status === 'failed' && onRetry && (
            <button onClick={onRetry}>
              <RefreshCw size={15} /> Retry
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
