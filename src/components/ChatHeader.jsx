import { useState } from 'react'
import {
  Archive,
  ArrowLeft,
  Bell,
  BellOff,
  MoreVertical,
  Phone,
  Pin,
  Search,
  Video,
} from 'lucide-react'
import Avatar from './Avatar'
import IconButton from './IconButton'

const MUTE_OPTIONS = [
  { label: '1 hour', ms: 60 * 60 * 1000 },
  { label: '8 hours', ms: 8 * 60 * 60 * 1000 },
  { label: '1 day', ms: 24 * 60 * 60 * 1000 },
  { label: '1 week', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: 'Forever', ms: null },
]

function getMutedUntil(ms) {
  return ms === null ? '9999-12-31T23:59:59.000Z' : new Date(Date.now() + ms).toISOString()
}

export default function ChatHeader({
  contact,
  chat,
  onBack,
  onOpenProfile,
  onToggleSearch,
  onTogglePin,
  onMuteChat,
  onArchive,
  onOpenCall,
}) {
  const [muteMenuOpen, setMuteMenuOpen] = useState(false)

  function handleMuteClick() {
    if (chat.muted) {
      onMuteChat(null)
    } else {
      setMuteMenuOpen((current) => !current)
    }
  }

  function selectMuteDuration(ms) {
    onMuteChat(getMutedUntil(ms))
    setMuteMenuOpen(false)
  }

  return (
    <header className="chat-header">
      <IconButton label="Back to chats" className="mobile-back" onClick={onBack}>
        <ArrowLeft size={20} />
      </IconButton>
      <button className="chat-title" onClick={onOpenProfile}>
        <Avatar contact={contact} />
        <span>
          <strong>{contact.name}</strong>
          <small className={contact.status === 'online' ? 'online-text' : ''}>{contact.lastSeen}</small>
        </span>
      </button>
      <nav className="header-actions">
        <IconButton label="Search messages" onClick={onToggleSearch}>
          <Search size={19} />
        </IconButton>
        <IconButton label="Audio call" onClick={() => onOpenCall('audio')}>
          <Phone size={19} />
        </IconButton>
        <IconButton label="Video call" onClick={() => onOpenCall('video')}>
          <Video size={19} />
        </IconButton>
        <IconButton label={chat.pinned ? 'Unpin chat' : 'Pin chat'} onClick={onTogglePin}>
          <Pin size={19} />
        </IconButton>
        <div className="mute-wrapper">
          <IconButton label={chat.muted ? 'Unmute chat' : 'Mute chat'} onClick={handleMuteClick}>
            {chat.muted ? <Bell size={19} /> : <BellOff size={19} />}
          </IconButton>
          {muteMenuOpen && (
            <>
              <div className="mute-dropdown">
                {MUTE_OPTIONS.map((option) => (
                  <button key={option.label} onClick={() => selectMuteDuration(option.ms)}>
                    {option.label}
                  </button>
                ))}
              </div>
              <button className="mute-scrim" onClick={() => setMuteMenuOpen(false)} />
            </>
          )}
        </div>
        <IconButton label={chat.archived ? 'Unarchive chat' : 'Archive chat'} onClick={onArchive}>
          <Archive size={19} />
        </IconButton>
        <IconButton label="Chat menu" onClick={onOpenProfile}>
          <MoreVertical size={19} />
        </IconButton>
      </nav>
    </header>
  )
}
