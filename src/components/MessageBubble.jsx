import { useEffect, useState } from 'react'
import { AlertCircle, Check, CheckCheck, CheckSquare, Copy, Download, Edit3, ExternalLink, FileText, Flag, Forward, Pin, Play, RefreshCw, Reply, SmilePlus, Square, Timer, Trash2 } from 'lucide-react'
import { formatMessageTime } from '../utils/formatters'
import { t } from '../i18n'
import FormattedText from '../utils/textFormat'
import { getLinkPreview } from '../api/client'
import AudioMessagePlayer from './AudioMessagePlayer'
import RichMessage from './RichMessage'
import PollCard from './PollCard'

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

function formatDisappearTimer(disappearsAt) {
  const ms = new Date(disappearsAt).getTime() - Date.now()
  if (ms <= 0) return 'Disappearing…'
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `Disappears in ${secs}s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `Disappears in ${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `Disappears in ${hours}h`
  return `Disappears in ${Math.floor(hours / 24)}d`
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
        {(preview.siteName || preview.site) && <span className="link-preview-site">{preview.siteName || preview.site}</span>}
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
  albumPosition,
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
  onDownloadMedia,
  onForward,
  onPin,
  onToggleSelect,
  onRetry,
  onReport,
  onVotePoll,
}) {
  const reactionEntries = Object.entries(message.reactions || {}).filter(([, count]) => count > 0)
  const firstUrl = !message.deleted && !message.linkPreview && message.text ? extractFirstUrl(message.text) : null
  const fetchedPreview = useLinkPreview(firstUrl)
  const linkPreview = message.linkPreview || fetchedPreview

  return (
    <div className={`message-row ${isOwn ? 'own' : 'incoming'} ${selected ? 'selected' : ''} ${multiSelectMode ? 'multi-select-mode' : ''} ${multiSelected ? 'multi-selected' : ''} ${albumPosition?.previous ? 'album-continued' : ''} ${albumPosition?.next ? 'album-has-next' : ''}`}>
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
        onClick={multiSelectMode ? onSelect : undefined}
        onContextMenu={(e) => { e.preventDefault(); onSelect() }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') onSelect()
        }}
        role="button"
        tabIndex={0}
      >
        {message.disappearsAt && !message.deleted && (
          <div className="msg-timer-badge">
            <Timer size={11} />
            {formatDisappearTimer(message.disappearsAt)}
          </div>
        )}
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
          message.media.kind === 'voice' || message.media.kind === 'audio' ? (
            <AudioMessagePlayer media={message.media} compact={message.media.kind === 'voice'} />
          ) : message.media.kind === 'file' ? (
            <button
              className="message-file"
              onClick={(event) => {
                event.stopPropagation()
                onDownloadMedia?.(message.media)
              }}
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
            </button>
          ) : (
            <button
              className={`message-media ${message.media.kind}`}
              onClick={(event) => {
                event.stopPropagation()
                onOpenMedia(message.media, message)
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
        {message.albumId && (
          <small className="album-label">
            Album {message.albumIndex || 1}/{message.albumCount || 1}
          </small>
        )}
        {!message.deleted && message.poll && (
          <PollCard
            poll={message.poll}
            isOwn={isOwn}
            onVote={onVotePoll ? (optionIds) => onVotePoll(message.id, optionIds) : null}
          />
        )}
        {!message.deleted && message.rich && message.rich.type !== 'album' && <RichMessage rich={message.rich} />}
        {message.deleted ? (
          <em className="deleted-message">Message deleted</em>
        ) : message.rich ? (
          <RichMessage rich={message.rich} />
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
          {message.edited && <small>{t('msg.edited')}</small>}
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
            <Reply size={15} /> {t('msg.reply')}
          </button>
          <button onClick={onCopy}>
            <Copy size={15} /> {t('msg.copy')}
          </button>
          <button onClick={() => onReact('\u{1F44D}')}>
            <SmilePlus size={15} /> {t('msg.react')}
          </button>
          <button onClick={onForward}>
            <Forward size={15} /> {t('msg.forward')}
          </button>
          <button onClick={onToggleSelect}>
            <CheckSquare size={15} /> {t('msg.select')}
          </button>
          {onPin && (
            <button onClick={onPin}>
              <Pin size={15} /> {t('msg.pin')}
            </button>
          )}
          {isOwn && (
            <button onClick={onStartEdit}>
              <Edit3 size={15} /> {t('msg.edit')}
            </button>
          )}
          {isOwn && message.status === 'failed' && onRetry && (
            <button onClick={onRetry}>
              <RefreshCw size={15} /> {t('msg.retry')}
            </button>
          )}
          {!isOwn && onReport && (
            <button onClick={onReport}>
              <Flag size={15} /> {t('msg.report')}
            </button>
          )}
          <button className="danger" onClick={onDelete}>
            <Trash2 size={15} /> {t('msg.delete')}
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
