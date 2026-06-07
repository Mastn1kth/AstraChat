import { Send, X } from 'lucide-react'
import Avatar from './Avatar'
import { formatChatTime } from '../utils/formatters'

export default function ForwardModal({ message, chats, onForward, onClose }) {
  if (!message) return null
  const preview = message.text || (message.media ? `${message.media.kind} message` : 'Message')

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="modal forward-modal">
        <header>
          <div>
            <strong>Forward message</strong>
            <p>{preview}</p>
          </div>
          <button onClick={onClose} aria-label="Close forward dialog">
            <X size={20} />
          </button>
        </header>
        <div className="contact-list">
          {chats.map((chat) => (
            <button key={chat.id} onClick={() => onForward(chat.id)}>
              <Avatar contact={chat.contact} />
              <span>
                <strong>{chat.contact.name}</strong>
                <small>{chat.lastMessageText || 'No messages yet'}</small>
              </span>
              <time>{formatChatTime(chat.lastMessageTime)}</time>
              <Send size={17} />
            </button>
          ))}
          {!chats.length && <p className="drawer-empty">No chats available.</p>}
        </div>
      </section>
    </div>
  )
}
