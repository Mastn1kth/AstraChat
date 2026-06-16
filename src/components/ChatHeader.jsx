import { useState } from 'react'
import {
  Archive,
  ArrowLeft,
  Bell,
  BellOff,
  BellRing,
  MoreVertical,
  Phone,
  Pin,
  Search,
  Video,
} from 'lucide-react'
import Avatar from './Avatar'
import { t } from '../i18n'
import IconButton from './IconButton'

const MUTE_OPTIONS = [
  { labelKey: 'mute.1h', ms: 60 * 60 * 1000 },
  { labelKey: 'mute.8h', ms: 8 * 60 * 60 * 1000 },
  { labelKey: 'mute.1d', ms: 24 * 60 * 60 * 1000 },
  { labelKey: 'mute.1w', ms: 7 * 24 * 60 * 60 * 1000 },
  { labelKey: 'mute.forever', ms: null },
]

const PUSH_MODE_OPTIONS = [
  { id: 'default', labelKey: 'push.default' },
  { id: 'all', labelKey: 'push.all' },
  { id: 'mentions', labelKey: 'push.mentions' },
  { id: 'off', labelKey: 'push.off' },
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
  onSetPushMode,
  onArchive,
  onOpenCall,
}) {
  const [muteMenuOpen, setMuteMenuOpen] = useState(false)
  const [pushMenuOpen, setPushMenuOpen] = useState(false)

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

  function selectPushMode(pushMode) {
    onSetPushMode(pushMode)
    setPushMenuOpen(false)
  }

  return (
    <header className="chat-header">
      <IconButton label={t('chat.back')} className="mobile-back" onClick={onBack}>
        <ArrowLeft size={20} />
      </IconButton>
      <button className="chat-title" onClick={onOpenProfile}>
        <Avatar contact={contact} />
        <span>
          <strong>{contact.name}</strong>
          <small className={contact.status === 'online' && !contact.customStatus ? 'online-text' : ''}>
            {contact.customStatus || contact.lastSeen}
          </small>
          {contact.customStatus && (
            <small className={contact.status === 'online' ? 'online-text' : ''}>{contact.lastSeen}</small>
          )}
        </span>
      </button>
      <nav className="header-actions">
        <IconButton label={t('chat.searchMessages')} onClick={onToggleSearch}>
          <Search size={19} />
        </IconButton>
        <IconButton label={t('chat.audioCall')} onClick={() => onOpenCall('audio')}>
          <Phone size={19} />
        </IconButton>
        <IconButton label={t('chat.videoCall')} onClick={() => onOpenCall('video')}>
          <Video size={19} />
        </IconButton>
        <IconButton label={chat.pinned ? t('chat.unpin') : t('chat.pin')} onClick={onTogglePin}>
          <Pin size={19} />
        </IconButton>
        <div className="mute-wrapper">
          <IconButton label={chat.muted ? t('chat.unmute') : t('chat.mute')} onClick={handleMuteClick}>
            {chat.muted ? <Bell size={19} /> : <BellOff size={19} />}
          </IconButton>
          {muteMenuOpen && (
            <>
              <div className="mute-dropdown">
                {MUTE_OPTIONS.map((option) => (
                  <button key={option.labelKey} onClick={() => selectMuteDuration(option.ms)}>
                    {t(option.labelKey)}
                  </button>
                ))}
              </div>
              <button className="mute-scrim" onClick={() => setMuteMenuOpen(false)} />
            </>
          )}
        </div>
        <div className="mute-wrapper">
          <IconButton
            label={t('chat.pushLabel', { mode: t(PUSH_MODE_OPTIONS.find((option) => option.id === (chat.pushMode || 'default'))?.labelKey || 'push.default') })}
            onClick={() => setPushMenuOpen((current) => !current)}
          >
            <BellRing size={19} />
          </IconButton>
          {pushMenuOpen && (
            <>
              <div className="mute-dropdown push-dropdown">
                {PUSH_MODE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    className={(chat.pushMode || 'default') === option.id ? 'active' : ''}
                    onClick={() => selectPushMode(option.id)}
                  >
                    {t(option.labelKey)}
                  </button>
                ))}
              </div>
              <button className="mute-scrim" onClick={() => setPushMenuOpen(false)} />
            </>
          )}
        </div>
        <IconButton label={chat.archived ? t('chat.unarchive') : t('chat.archive')} onClick={onArchive}>
          <Archive size={19} />
        </IconButton>
        <IconButton label={t('chat.menu')} onClick={onOpenProfile}>
          <MoreVertical size={19} />
        </IconButton>
      </nav>
    </header>
  )
}
