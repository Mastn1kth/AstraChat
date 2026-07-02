import { UserMinus, UserPlus, X } from 'lucide-react'
import Avatar from './Avatar'
import { useFocusTrap } from '../hooks/useFocusTrap'

export default function ContactModal({ contacts, chats, onCreateChat, onRemoveContact, onClose }) {
  const trapRef = useFocusTrap(onClose)
  const chatContactIds = new Set(chats.map((chat) => chat.contactId))
  const savedContacts = contacts.filter((contact) => contact.type === 'private' && contact.isContact)

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="contact-modal-title">
      <section className="modal contact-modal" ref={trapRef}>
        <header>
          <div>
            <strong id="contact-modal-title">New private chat</strong>
            <p>Pick a saved contact or add people from the contacts drawer.</p>
          </div>
          <button onClick={onClose} aria-label="Close contacts">
            <X size={20} />
          </button>
        </header>
        <div className="contact-list">
          {savedContacts.map((contact) => {
            const exists = chatContactIds.has(contact.id)
            return (
              <div key={contact.id} className="modal-contact-row">
                <button onClick={() => onCreateChat(contact.id)}>
                  <Avatar contact={contact} />
                  <span>
                    <strong>{contact.name}</strong>
                    <small>{exists ? 'Open existing private chat' : contact.lastSeen}</small>
                  </span>
                </button>
                <button
                  type="button"
                  className="modal-contact-action"
                  title="Remove contact"
                  aria-label={`Remove ${contact.name} from contacts`}
                  onClick={() => onRemoveContact?.(contact.id)}
                >
                  <UserMinus size={16} />
                </button>
              </div>
            )
          })}
          {!savedContacts.length && (
            <div className="contact-empty-state">
              <p>No saved contacts yet.</p>
              <button type="button" onClick={onClose}>
                <UserPlus size={16} /> Search from the main contacts drawer
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
