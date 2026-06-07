import { useMemo, useState } from 'react'
import {
  Archive,
  Bell,
  BellOff,
  Bot,
  Image,
  Link as LinkIcon,
  Play,
  Shield,
  Users,
  Pin,
  X,
} from 'lucide-react'
import Avatar from './Avatar'
import { formatMessageTime } from '../utils/formatters'

const linkPattern = /\bhttps?:\/\/[^\s<>"']+/gi

function extractLinks(message) {
  return Array.from(message.text?.matchAll(linkPattern) || []).map((match) =>
    match[0].replace(/[),.;!?]+$/g, ''),
  )
}

export default function ProfilePanel({
  contact,
  chat,
  contacts,
  messages,
  onMockAction,
  onClose,
  onTogglePin,
  onToggleMute,
  onArchive,
  onOpenMedia,
}) {
  const [sharedTab, setSharedTab] = useState('media')
  const title =
    contact.type === 'group' ? 'Group profile' : contact.type === 'channel' ? 'Channel profile' : contact.type === 'bot' ? 'Bot profile' : 'Contact profile'
  const memberNames = (contact.members || [])
    .map((id) => {
      if (!id) return null
      const found = contacts.find((item) => item.id === id)
      // 'me' is the local mock id; server ids are UUIDs — use name lookup as the primary source
      return found?.name ?? (id === 'me' ? 'You' : null)
    })
    .filter(Boolean)
  const sharedMedia = useMemo(
    () =>
      messages
        .filter((message) => message.media && !message.deleted && !message.media.decryptFailed)
        .map((message) => ({
          ...message.media,
          messageId: message.id,
          time: message.time,
        })),
    [messages],
  )
  const sharedLinks = useMemo(
    () =>
      messages.flatMap((message) =>
        message.deleted
          ? []
          : extractLinks(message).map((url) => ({
              url,
              messageId: message.id,
              time: message.time,
            })),
      ),
    [messages],
  )

  return (
    <aside className="side-panel profile-panel">
      <header>
        <strong>{title}</strong>
        <button onClick={onClose} aria-label="Close profile">
          <X size={20} />
        </button>
      </header>
      <div className="profile-hero">
        <Avatar contact={contact} size="lg" />
        <h2>{contact.name}</h2>
        <p className={contact.status === 'online' ? 'online-text' : ''}>{contact.lastSeen}</p>
      </div>
      <dl className="profile-data">
        <div>
          <dt>Username</dt>
          <dd>{contact.username}</dd>
        </div>
        <div>
          <dt>Phone</dt>
          <dd>{contact.phone || 'Hidden / not applicable'}</dd>
        </div>
        <div>
          <dt>About</dt>
          <dd>{contact.bio}</dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>{contact.type || 'private'}</dd>
        </div>
        {contact.type === 'group' && (
          <div>
            <dt>Members and roles</dt>
            <dd>{memberNames.join(', ')}. Current user role: {contact.role || 'member'}.</dd>
          </div>
        )}
        {contact.type === 'channel' && (
          <div>
            <dt>Channel controls</dt>
            <dd>{contact.subscribers || 0} subscribers, linked discussion and scheduled posts are mock UI states.</dd>
          </div>
        )}
        {contact.type === 'bot' && (
          <div>
            <dt>Bot commands</dt>
            <dd>/start, /help, /settings. Callbacks and mini app button are mocked locally.</dd>
          </div>
        )}
      </dl>
      <div className="panel-actions">
        <button onClick={onTogglePin}>
          <Pin size={17} /> {chat.pinned ? 'Unpin chat' : 'Pin chat'}
        </button>
        <button onClick={onToggleMute}>
          {chat.muted ? <Bell size={17} /> : <BellOff size={17} />}
          {chat.muted ? 'Unmute' : 'Mute'}
        </button>
        <button onClick={onArchive}>
          <Archive size={17} /> {chat.archived ? 'Unarchive' : 'Archive'}
        </button>
        {contact.type === 'group' && (
          <button onClick={() => onMockAction('[mock] group admin panel: roles, bans, slow mode, anti-spam')}>
            <Shield size={17} /> Group admin settings
          </button>
        )}
        {contact.type === 'channel' && (
          <button onClick={() => onMockAction('[mock] channel stats: views, growth, reposts, discussion moderation')}>
            <Users size={17} /> Channel statistics
          </button>
        )}
        {contact.type === 'bot' && (
          <button onClick={() => onMockAction('[mock] bot mini app opened with user data permissions')}>
            <Bot size={17} /> Open mini app
          </button>
        )}
      </div>
      <section className="shared-panel">
        <div className="shared-tabs">
          <button className={sharedTab === 'media' ? 'active' : ''} onClick={() => setSharedTab('media')}>
            <Image size={15} /> Media
          </button>
          <button className={sharedTab === 'links' ? 'active' : ''} onClick={() => setSharedTab('links')}>
            <LinkIcon size={15} /> Links
          </button>
        </div>

        {sharedTab === 'media' && (
          <div className="shared-media-grid">
            {sharedMedia.map((media) => (
              <button key={`${media.messageId}-${media.id}`} onClick={() => onOpenMedia(media)}>
                {media.kind === 'image' ? (
                  <img src={media.url} alt={media.name || 'Shared media'} loading="lazy" />
                ) : (
                  <>
                    <video src={media.url} preload="metadata" muted />
                    <span>
                      <Play size={18} fill="currentColor" />
                    </span>
                  </>
                )}
              </button>
            ))}
            {!sharedMedia.length && <p className="shared-empty">No shared media yet.</p>}
          </div>
        )}

        {sharedTab === 'links' && (
          <div className="shared-links-list">
            {sharedLinks.map((link) => (
              <a key={`${link.messageId}-${link.url}`} href={link.url} target="_blank" rel="noreferrer">
                <LinkIcon size={16} />
                <span>
                  <strong>{link.url}</strong>
                  <small>{formatMessageTime(link.time)}</small>
                </span>
              </a>
            ))}
            {!sharedLinks.length && <p className="shared-empty">No shared links yet.</p>}
          </div>
        )}
      </section>
    </aside>
  )
}
