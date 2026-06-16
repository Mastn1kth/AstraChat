import { useState } from 'react'
import { X } from 'lucide-react'

export default function CatchUpBanner({ chats, onCatchUp }) {
  const [dismissed, setDismissed] = useState(false)

  const unreadChats = chats.filter((c) => c.unread > 0 && !c.archived)
  const total = unreadChats.reduce((sum, c) => sum + c.unread, 0)

  if (total === 0 || dismissed) return null

  return (
    <div className="catchup-banner">
      <span className="catchup-text">
        {total} {total === 1 ? 'сообщение' : total < 5 ? 'сообщения' : 'сообщений'} в{' '}
        {unreadChats.length} {unreadChats.length === 1 ? 'чате' : unreadChats.length < 5 ? 'чатах' : 'чатах'}
      </span>
      <button className="catchup-btn" onClick={onCatchUp}>
        Догнать
      </button>
      <button className="catchup-dismiss" onClick={() => setDismissed(true)} aria-label="Закрыть">
        <X size={14} />
      </button>
    </div>
  )
}
