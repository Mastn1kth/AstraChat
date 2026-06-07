import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown } from 'lucide-react'
import MessageBubble from './MessageBubble'
import { formatDateDivider } from '../utils/formatters'

export default function MessageList({
  messages,
  contact,
  currentUser,
  search,
  selectedMessageId,
  onSelectMessage,
  onStartReply,
  onStartEdit,
  onDeleteMessage,
  onCopyMessage,
  onReact,
  onOpenMedia,
  onForwardMessage,
}) {
  const listRef = useRef(null)
  const bottomRef = useRef(null)
  const messageRefs = useRef({})
  const highlightTimerRef = useRef(null)
  const [showJump, setShowJump] = useState(false)
  const [highlightId, setHighlightId] = useState('')

  useEffect(() => () => window.clearTimeout(highlightTimerRef.current), [])

  function jumpToMessage(messageId) {
    if (!messageId) return
    const element = messageRefs.current[messageId]
    if (!element) return
    element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setHighlightId(messageId)
    window.clearTimeout(highlightTimerRef.current)
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightId((current) => (current === messageId ? '' : current))
    }, 1600)
  }

  const replyMap = useMemo(() => {
    return messages.reduce((acc, message) => {
      acc[message.id] = message
      return acc
    }, {})
  }, [messages])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  function handleScroll() {
    const element = listRef.current
    if (!element) return
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    setShowJump(distance > 260)
  }

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
    <section className="message-list" ref={listRef} onScroll={handleScroll}>
      {messages.map((message, index) => {
        const dateKey = new Date(message.time).toDateString()
        const previousDateKey = index > 0 ? new Date(messages[index - 1].time).toDateString() : ''
        const showDivider = dateKey !== previousDateKey
        const matched =
          search.trim() && message.text?.toLowerCase().includes(search.trim().toLowerCase())

        return (
          <div
            key={message.id}
            ref={(element) => {
              if (element) messageRefs.current[message.id] = element
              else delete messageRefs.current[message.id]
            }}
          >
            {showDivider && <div className="date-divider">{formatDateDivider(message.time)}</div>}
            <MessageBubble
              message={message}
              highlighted={message.id === highlightId}
              onJumpToReply={jumpToMessage}
              replyMessage={(() => {
                if (!message.replyToId) return null
                const rm = replyMap[message.replyToId]
                if (!rm) return null
                return {
                  ...rm,
                  senderName: rm.senderId === currentUser.id ? 'You' : contact.name,
                }
              })()}
              sender={message.senderId === currentUser.id ? currentUser : contact}
              isOwn={message.senderId === currentUser.id}
              selected={message.id === selectedMessageId}
              matched={Boolean(matched)}
              onSelect={() => onSelectMessage(message.id)}
              onStartReply={() => onStartReply(message)}
              onStartEdit={() => onStartEdit(message)}
              onDelete={() => onDeleteMessage(message.id)}
              onCopy={() => onCopyMessage(message)}
              onReact={(emoji) => onReact(message.id, emoji)}
              onOpenMedia={onOpenMedia}
              onForward={() => onForwardMessage(message)}
            />
          </div>
        )
      })}
      {contact.status === 'typing' && (
        <div className="typing-row">
          <span />
          <span />
          <span />
          {contact.name} is typing...
        </div>
      )}
      <div ref={bottomRef} />
      {showJump && (
        <button className="jump-button" onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}>
          <ArrowDown size={18} />
        </button>
      )}
    </section>
  )
}
