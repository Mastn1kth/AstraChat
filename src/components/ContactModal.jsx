import { X } from 'lucide-react'
import Avatar from './Avatar'

export default function ContactModal({ contacts, chats, onCreateChat, onClose }) {
  const chatContactIds = new Set(chats.map((chat) => chat.contactId))

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="modal contact-modal">
        <header>
          <div>
            <strong>New private chat</strong>
            <p>Only 1-on-1 conversations are available in this MVP.</p>
          </div>
          <button onClick={onClose} aria-label="Close contacts">
            <X size={20} />
          </button>
        </header>
        <div className="contact-list">
          {contacts.map((contact) => {
            const exists = chatContactIds.has(contact.id)
            return (
              <button key={contact.id} onClick={() => onCreateChat(contact.id)}>
                <Avatar contact={contact} />
                <span>
                  <strong>{contact.name}</strong>
                  <small>{exists ? 'Open existing private chat' : contact.lastSeen}</small>
                </span>
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}
