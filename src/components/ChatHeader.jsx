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

export default function ChatHeader({
  contact,
  chat,
  onBack,
  onOpenProfile,
  onToggleSearch,
  onTogglePin,
  onToggleMute,
  onArchive,
  onOpenCall,
}) {
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
        <IconButton label={chat.muted ? 'Unmute chat' : 'Mute chat'} onClick={onToggleMute}>
          {chat.muted ? <Bell size={19} /> : <BellOff size={19} />}
        </IconButton>
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
