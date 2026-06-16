import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ChevronUp, Sparkles } from 'lucide-react'
import { List, useDynamicRowHeight } from 'react-window'
import MessageBubble from './MessageBubble'
import { formatDateDivider } from '../utils/formatters'

function typingLabel(contact, typingUsers = []) {
  const names = typingUsers.map((user) => user?.name).filter(Boolean)

  if (!names.length) return `${contact.name} is typing...`
  if (names.length === 1) return `${names[0]} is typing...`
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing...`
  return `${names[0]}, ${names[1]} and ${names.length - 2} others are typing...`
}

function MessageListRow({
  index,
  style,
  ariaAttributes,
  contact,
  currentUser,
  highlightId,
  multiSelectMode,
  onCopyMessage,
  onDeleteMessage,
  onDownloadMedia,
  onForwardMessage,
  onJumpToMessage,
  onLoadMore,
  onOpenMedia,
  onPinMessage,
  onReact,
  onReportMessage,
  onRetryMessage,
  onSelectMessage,
  onStartEdit,
  onStartReply,
  onToggleMessageSelection,
  onVotePoll,
  replyMap,
  rows,
  selectedMessageId,
  selectedMessageIds,
}) {
  const row = rows[index]
  if (!row) return null

  if (row.type === 'load-more') {
    return (
      <div className="message-list-virtual-row message-list-load-row" style={style} {...ariaAttributes}>
        <button className="load-more-button" onClick={onLoadMore}>
          <ChevronUp size={15} /> Load earlier messages
        </button>
      </div>
    )
  }

  if (row.type === 'typing') {
    return (
      <div className="message-list-virtual-row" style={style} {...ariaAttributes}>
        <div className="typing-row">
          <span />
          <span />
          <span />
          {typingLabel(contact, row.typingUsers)}
        </div>
      </div>
    )
  }

  const { albumPosition, matched, message, showDivider, showUnreadSeparator } = row
  const replyMessage = message.replyToId ? replyMap[message.replyToId] : null
  const sender = message.senderId === currentUser.id ? currentUser : contact

  return (
    <div
      className="message-list-virtual-row"
      data-message-id={message.id}
      style={style}
      {...ariaAttributes}
    >
      {showDivider && <div className="date-divider">{formatDateDivider(message.time)}</div>}
      {showUnreadSeparator && <div className="unread-separator"><span>New messages</span></div>}
      <MessageBubble
        message={message}
        albumPosition={albumPosition}
        highlighted={message.id === highlightId}
        multiSelectMode={multiSelectMode}
        multiSelected={selectedMessageIds?.has(message.id)}
        onJumpToReply={onJumpToMessage}
        replyMessage={
          replyMessage
            ? {
                ...replyMessage,
                senderName: replyMessage.senderId === currentUser.id ? 'You' : contact.name,
              }
            : null
        }
        sender={sender}
        isOwn={message.senderId === currentUser.id || message.senderId === 'me'}
        selected={message.id === selectedMessageId}
        matched={matched}
        onSelect={() => {
          if (multiSelectMode) {
            onToggleMessageSelection(message.id)
          } else {
            onSelectMessage(message.id)
          }
        }}
        onStartReply={() => onStartReply(message)}
        onStartEdit={() => onStartEdit(message)}
        onDelete={() => onDeleteMessage(message.id)}
        onCopy={() => onCopyMessage(message)}
        onReact={(emoji) => onReact(message.id, emoji)}
        onOpenMedia={onOpenMedia}
        onDownloadMedia={onDownloadMedia}
        onForward={() => onForwardMessage(message)}
        onPin={() => onPinMessage(message.id)}
        onToggleSelect={() => onToggleMessageSelection(message.id)}
        onRetry={onRetryMessage ? () => onRetryMessage(message.id) : undefined}
        onReport={() => onReportMessage?.(message)}
        onVotePoll={onVotePoll ? (messageId, optionIds) => onVotePoll(messageId, optionIds) : undefined}
      />
    </div>
  )
}

export default function MessageList({
  messages,
  contact,
  currentUser,
  search,
  typingUsers = [],
  selectedMessageId,
  selectedMessageIds,
  multiSelectMode,
  hasMore,
  onSelectMessage,
  onToggleMessageSelection,
  onLoadMore,
  onStartReply,
  onStartEdit,
  onDeleteMessage,
  onCopyMessage,
  onReact,
  onOpenMedia,
  onDownloadMedia,
  onForwardMessage,
  onPinMessage,
  onRetryMessage,
  onReportMessage,
  onVotePoll,
  unreadFromId,
}) {
  const listRef = useRef(null)
  const highlightTimerRef = useRef(null)
  const [showJump, setShowJump] = useState(false)
  const [highlightId, setHighlightId] = useState('')
  const rows = useMemo(() => {
    const nextRows = []
    if (hasMore) nextRows.push({ id: 'load-more', type: 'load-more' })

    const query = search.trim().toLowerCase()
    messages.forEach((message, index) => {
      const dateKey = new Date(message.time).toDateString()
      const previousDateKey = index > 0 ? new Date(messages[index - 1].time).toDateString() : ''
      nextRows.push({
        id: message.id,
        type: 'message',
        message,
        showDivider: dateKey !== previousDateKey,
        showUnreadSeparator: Boolean(unreadFromId && message.id === unreadFromId),
        matched: Boolean(query && message.text?.toLowerCase().includes(query)),
        albumPosition: message.albumId
          ? {
              previous: messages[index - 1]?.albumId === message.albumId,
              next: messages[index + 1]?.albumId === message.albumId,
            }
          : null,
      })
    })

    if (typingUsers.length || contact.status === 'typing') {
      nextRows.push({ id: 'typing', type: 'typing', typingUsers })
    }
    return nextRows
  }, [contact.status, hasMore, messages, search, typingUsers, unreadFromId])
  const messageRowIndex = useMemo(() => {
    const byId = new Map()
    rows.forEach((row, index) => {
      if (row.type === 'message') byId.set(row.id, index)
    })
    return byId
  }, [rows])
  const rowHeight = useDynamicRowHeight({
    defaultRowHeight: 92,
    key: `${contact.id || 'chat'}:${messages.length}`,
  })

  useEffect(() => () => window.clearTimeout(highlightTimerRef.current), [])

  const scrollToBottom = useCallback((behavior = 'smooth') => {
    if (!rows.length) return
    listRef.current?.scrollToRow({ index: rows.length - 1, align: 'end', behavior })
    setShowJump(false)
  }, [rows.length])

  const jumpToMessage = useCallback((messageId) => {
    if (!messageId) return
    const rowIndex = messageRowIndex.get(messageId)
    if (typeof rowIndex !== 'number') return
    listRef.current?.scrollToRow({ index: rowIndex, align: 'center', behavior: 'smooth' })
    setHighlightId(messageId)
    window.clearTimeout(highlightTimerRef.current)
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightId((current) => (current === messageId ? '' : current))
    }, 1600)
  }, [messageRowIndex])

  const replyMap = useMemo(() => {
    return messages.reduce((acc, message) => {
      acc[message.id] = message
      return acc
    }, {})
  }, [messages])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (!rows.length) return
      listRef.current?.scrollToRow({ index: rows.length - 1, align: 'end', behavior: 'auto' })
      setShowJump(false)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [messages.length, rows.length])

  useEffect(() => {
    if (!selectedMessageId) return
    if (!messages.some((message) => message.id === selectedMessageId)) return
    const frame = window.requestAnimationFrame(() => jumpToMessage(selectedMessageId))
    return () => window.cancelAnimationFrame(frame)
  }, [jumpToMessage, messages, selectedMessageId])

  function handleScroll(event) {
    const element = event.currentTarget
    if (!element) return
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    setShowJump(distance > 260)
  }

  const rowProps = useMemo(() => ({
    contact,
    currentUser,
    highlightId,
    multiSelectMode,
    onCopyMessage,
    onDeleteMessage,
    onDownloadMedia,
    onForwardMessage,
    onJumpToMessage: jumpToMessage,
    onLoadMore,
    onOpenMedia,
    onPinMessage,
    onReact,
    onReportMessage,
    onRetryMessage,
    onSelectMessage,
    onStartEdit,
    onStartReply,
    onToggleMessageSelection,
    onVotePoll,
    replyMap,
    rows,
    selectedMessageId,
    selectedMessageIds,
  }), [
    contact,
    currentUser,
    highlightId,
    jumpToMessage,
    multiSelectMode,
    onCopyMessage,
    onDeleteMessage,
    onDownloadMedia,
    onForwardMessage,
    onLoadMore,
    onOpenMedia,
    onPinMessage,
    onReact,
    onReportMessage,
    onRetryMessage,
    onSelectMessage,
    onStartEdit,
    onStartReply,
    onToggleMessageSelection,
    onVotePoll,
    replyMap,
    rows,
    selectedMessageId,
    selectedMessageIds,
  ])

  const unreadCount = useMemo(
    () => messages.filter((m) => unreadFromId && m.id >= unreadFromId && m.senderId !== currentUser.id).length,
    [messages, unreadFromId, currentUser.id],
  )

  if (!messages.length) {
    return (
      <section className="message-list empty-message-list">
        <div>
          <h2>No messages yet</h2>
          <p>Send the first private message to {contact.name}.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="message-list-shell">
      {unreadCount > 2 && (
        <button className="catchup-pill" onClick={() => {
          const idx = rows.findIndex((r) => r.id === unreadFromId)
          if (idx >= 0) listRef.current?.scrollToRow({ index: idx, align: 'start', behavior: 'smooth' })
        }}>
          <span className="catchup-ic"><Sparkles size={15} /></span>
          <span className="catchup-body">
            <strong>Catch up — {unreadCount} new message{unreadCount !== 1 ? 's' : ''}</strong>
            <span>Jump to first unread in this conversation</span>
          </span>
          <span className="catchup-go">Read summary</span>
        </button>
      )}
      <List
        className="message-list virtual-message-list"
        defaultHeight={640}
        listRef={listRef}
        onScroll={handleScroll}
        overscanCount={8}
        rowComponent={MessageListRow}
        rowCount={rows.length}
        rowHeight={rowHeight}
        rowProps={rowProps}
        style={{ height: '100%', width: '100%' }}
      />
      {showJump && (
        <button className="jump-button" onClick={() => scrollToBottom()}>
          <ArrowDown size={18} />
        </button>
      )}
    </section>
  )
}
