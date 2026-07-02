import { Hash, Users, X } from 'lucide-react'
import { useFocusTrap } from '../hooks/useFocusTrap'

export default function CreateSpaceModal({ mode, onCreate, onClose }) {
  const trapRef = useFocusTrap(onClose)
  const isGroup = mode === 'group'
  const title = isGroup ? 'Create group' : 'Create channel'
  const description = isGroup
    ? 'Local group shell with members, roles, topics and moderation settings.'
    : 'Local channel shell with subscribers, posts, views and discussion settings.'

  function handleSubmit(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const name = String(form.get('name') || '').trim()
    const username = String(form.get('username') || '').trim()
    const bio = String(form.get('bio') || '').trim()
    if (!name) return
    onCreate({
      type: mode,
      name,
      username: username.startsWith('@') ? username : `@${username || name.toLowerCase().replaceAll(' ', '-')}`,
      bio,
    })
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="create-space-modal-title">
      <form className="modal settings-modal" onSubmit={handleSubmit} ref={trapRef}>
        <header>
          <div>
            <strong id="create-space-modal-title">{title}</strong>
            <p>{description}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={`Close ${title}`}>
            <X size={20} />
          </button>
        </header>

        <div className="space-type-banner">
          {isGroup ? <Users size={18} /> : <Hash size={18} />}
          <span>{isGroup ? 'Owner, admins, members, topics' : 'Admin posts, subscribers, discussion group'}</span>
        </div>

        <label className="field-block">
          <span>Name</span>
          <input name="name" placeholder={isGroup ? 'Design team' : 'Product updates'} autoFocus />
        </label>
        <label className="field-block">
          <span>Username</span>
          <input name="username" placeholder={isGroup ? '@design-team' : '@product-updates'} />
        </label>
        <label className="field-block">
          <span>Description</span>
          <input name="bio" placeholder="Short public description" />
        </label>

        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" type="submit">
            {title}
          </button>
        </div>
      </form>
    </div>
  )
}
