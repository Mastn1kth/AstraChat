import { useEffect, useState } from 'react'
import { getAvatarBust, subscribeAvatarBust } from '../utils/avatarCache'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default function Avatar({ contact, size = 'md' }) {
  const canHavePhoto = Boolean(contact?.id && UUID_RE.test(contact.id))
  const [failedSrc, setFailedSrc] = useState('')
  const [bust, setBust] = useState(getAvatarBust)

  useEffect(() => {
    return subscribeAvatarBust(setBust)
  }, [])

  const photoSrc = canHavePhoto ? `/api/users/${contact.id}/avatar${bust ? `?v=${bust}` : ''}` : null
  const src = photoSrc && failedSrc !== photoSrc ? photoSrc : null

  return (
    <div className={`avatar avatar-${size}`} style={{ '--avatar-color': contact.color || '#2f80ed' }}>
      {src ? (
        <img className="avatar-photo" src={src} alt="" onError={() => setFailedSrc(src)} />
      ) : (
        <span>{contact.avatar}</span>
      )}
      {contact.status === 'online' && <i className="presence-dot" aria-label="online" />}
    </div>
  )
}
