import { useEffect, useMemo, useState } from 'react'
import {
  Archive,
  Bell,
  BellOff,
  Image,
  Link as LinkIcon,
  Loader2,
  Play,
  Plus,
  Shield,
  Trash2,
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
  currentUserId,
  onMockAction,
  onClose,
  onTogglePin,
  onToggleMute,
  onArchive,
  onOpenMedia,
  onLoadGroupMembers,
  onAddGroupMember,
  onRemoveGroupMember,
  onUpdateGroupInfo,
}) {
  const [sharedTab, setSharedTab] = useState('media')
  const [memberLoad, setMemberLoad] = useState({ chatId: null, members: null })
  const [addingMember, setAddingMember] = useState(false)
  const [addMemberId, setAddMemberId] = useState('')
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleInput, setTitleInput] = useState(contact.name || '')

  const isBackendGroup = chat.backend && (contact.type === 'group' || contact.type === 'channel')
  const isOwnerOrAdmin = contact.role === 'owner' || contact.role === 'admin'
  const members = memberLoad.chatId === chat.id ? memberLoad.members : null
  const membersLoading = Boolean(isBackendGroup && onLoadGroupMembers && memberLoad.chatId !== chat.id)

  // Load members for backend groups when panel opens
  useEffect(() => {
    if (!isBackendGroup || !onLoadGroupMembers) return undefined

    let cancelled = false
    onLoadGroupMembers(chat.id)
      .then((list) => {
        if (!cancelled) setMemberLoad({ chatId: chat.id, members: list || [] })
      })
      .catch(() => {
        if (!cancelled) setMemberLoad({ chatId: chat.id, members: [] })
      })

    return () => { cancelled = true }
  }, [chat.id, isBackendGroup, onLoadGroupMembers])

  const title =
    contact.type === 'group' ? 'Group profile' :
    contact.type === 'channel' ? 'Channel profile' :
    'Contact profile'

  // Fallback member names from local contacts (for non-backend groups)
  const memberNames = (contact.members || [])
    .map((id) => {
      if (!id) return null
      const found = contacts.find((item) => item.id === id)
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

  async function handleAddMember(e) {
    e.preventDefault()
    if (!addMemberId.trim()) return
    try {
      await onAddGroupMember(chat.id, addMemberId.trim())
      setAddMemberId('')
      setAddingMember(false)
      // Reload member list
      const list = await onLoadGroupMembers(chat.id)
      setMemberLoad({ chatId: chat.id, members: list || [] })
    } catch {
      // toast shown by App.jsx
    }
  }

  async function handleRemoveMember(userId) {
    if (!window.confirm('Remove this member?')) return
    try {
      await onRemoveGroupMember(chat.id, userId)
      setMemberLoad((current) => (
        current.chatId === chat.id
          ? { ...current, members: (current.members || []).filter((m) => m.id !== userId) }
          : current
      ))
    } catch {
      // toast shown by App.jsx
    }
  }

  async function handleSaveTitle(e) {
    e.preventDefault()
    if (!titleInput.trim()) return
    try {
      await onUpdateGroupInfo(chat.id, { title: titleInput.trim() })
      setEditingTitle(false)
    } catch {
      // toast shown by App.jsx
    }
  }

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
        {editingTitle && isOwnerOrAdmin ? (
          <form className="group-title-form" onSubmit={handleSaveTitle}>
            <input
              autoFocus
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              placeholder="Group name"
              maxLength={64}
            />
            <button type="submit">Save</button>
            <button type="button" onClick={() => setEditingTitle(false)}>Cancel</button>
          </form>
        ) : (
          <h2
            className={isBackendGroup && isOwnerOrAdmin ? 'editable-title' : ''}
            onClick={() => isBackendGroup && isOwnerOrAdmin && setEditingTitle(true)}
            title={isBackendGroup && isOwnerOrAdmin ? 'Click to rename' : ''}
          >
            {contact.name}
          </h2>
        )}
        <p className={contact.status === 'online' ? 'online-text' : ''}>{contact.lastSeen}</p>
      </div>

      <dl className="profile-data">
        {contact.username && (
          <div>
            <dt>Username</dt>
            <dd>{contact.username}</dd>
          </div>
        )}
        {contact.phone && (
          <div>
            <dt>Phone</dt>
            <dd>{contact.phone}</dd>
          </div>
        )}
        {contact.bio && (
          <div>
            <dt>About</dt>
            <dd>{contact.bio}</dd>
          </div>
        )}
        <div>
          <dt>Type</dt>
          <dd>{contact.type || 'private'}</dd>
        </div>
        {contact.type === 'channel' && (
          <div>
            <dt>Subscribers</dt>
            <dd>{contact.subscribers || 0}</dd>
          </div>
        )}
      </dl>

      {/* Group members section */}
      {(contact.type === 'group' || contact.type === 'channel') && (
        <section className="group-members-section">
          <div className="group-members-header">
            <strong><Users size={15} /> Members</strong>
            {isBackendGroup && isOwnerOrAdmin && (
              <button
                className="add-member-btn"
                onClick={() => setAddingMember((v) => !v)}
                title="Add member"
              >
                <Plus size={15} />
              </button>
            )}
          </div>

          {addingMember && (
            <form className="add-member-form" onSubmit={handleAddMember}>
              <input
                autoFocus
                value={addMemberId}
                onChange={(e) => setAddMemberId(e.target.value)}
                placeholder="User ID to add"
              />
              <button type="submit">Add</button>
              <button type="button" onClick={() => setAddingMember(false)}>✕</button>
            </form>
          )}

          {membersLoading ? (
            <div className="members-loading"><Loader2 size={16} className="spin" /> Loading…</div>
          ) : members ? (
            <ul className="members-list">
              {members.map((m) => (
                <li key={m.id} className="member-item">
                  <span className="member-name">
                    {m.name}
                    <small className="member-role">{m.role}</small>
                  </span>
                  {isOwnerOrAdmin && m.id !== currentUserId && (
                    <button
                      className="remove-member-btn"
                      onClick={() => handleRemoveMember(m.id)}
                      title="Remove member"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : !isBackendGroup ? (
            <p className="members-local">{memberNames.join(', ') || 'No members'}</p>
          ) : null}
        </section>
      )}

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
          <button onClick={() => onMockAction('[mock] group admin panel: bans, slow mode, anti-spam')}>
            <Shield size={17} /> Admin settings
          </button>
        )}
        {contact.type === 'channel' && (
          <button onClick={() => onMockAction('[mock] channel stats: views, growth, reposts')}>
            <Users size={17} /> Statistics
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
