import { useEffect, useMemo, useState } from 'react'
import { useConfirm } from '../hooks/useConfirm'
import {
  Archive,
  Ban,
  Bell,
  BellOff,
  Check,
  Copy,
  FileText,
  Flag,
  Image,
  Link as LinkIcon,
  Loader2,
  Music,
  Phone,
  Play,
  Plus,
  Shield,
  Trash2,
  Users,
  Pin,
  X,
} from 'lucide-react'
import Avatar from './Avatar'
import FocusSchedule from './FocusSchedule'
import { formatMessageTime } from '../utils/formatters'
import { t } from '../i18n'
import { getChannelStats, getChatAdminLog, getChatBans, unbanChatMember, getChatInvites, createChatInvite, revokeChatInvite, getChatJoinRequests, reviewChatJoinRequest, getChatMedia } from '../api/client'

const linkPattern = /\bhttps?:\/\/[^\s<>"']+/gi
const roleOptions = ['owner', 'admin', 'moderator', 'member']
const permissionOptions = [
  ['send_messages', 'Messages'],
  ['send_media', 'Media'],
  ['send_polls', 'Polls'],
  ['pin_messages', 'Pin'],
  ['delete_messages', 'Delete'],
  ['ban_users', 'Ban'],
  ['manage_members', 'Members'],
  ['manage_topics', 'Topics'],
  ['post_messages', 'Posts'],
  ['view_stats', 'Stats'],
]

function extractLinks(message) {
  return Array.from(message.text?.matchAll(linkPattern) || []).map((match) =>
    match[0].replace(/[),.;!?]+$/g, ''),
  )
}

function formatCallTime(value) {
  if (!value) return ''
  const date = new Date(value)
  return date.toLocaleString([], {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function callStatusLabel(call) {
  if (call.status === 'accepted' && !call.endedAt) return 'active'
  if (call.status === 'accepted') return 'answered'
  return call.status
}

export default function ProfilePanel({
  contact,
  chat,
  contacts,
  messages,
  currentUserId,
  onClose,
  onTogglePin,
  onToggleMute,
  onArchive,
  onOpenMedia,
  onLoadGroupMembers,
  onLoadCallHistory,
  onAddGroupMember,
  onRemoveGroupMember,
  onUpdateGroupInfo,
  onUpdateGroupMemberRole,
  onUpdateGroupMemberPermissions,
  onBlockUser,
  onUnblockUser,
  onReportUser,
}) {
  const [sharedTab, setSharedTab] = useState('media')
  const [serverMedia, setServerMedia] = useState({ chatId: null, items: null, hasMore: false, nextBefore: null, loading: false })
  const [memberLoad, setMemberLoad] = useState({ chatId: null, members: null })
  const [callHistoryLoad, setCallHistoryLoad] = useState({ chatId: null, calls: null })
  const [addingMember, setAddingMember] = useState(false)
  const [addMemberId, setAddMemberId] = useState('')
  const [savingMemberId, setSavingMemberId] = useState('')
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleInput, setTitleInput] = useState(contact.name || '')
  const [adminPanel, setAdminPanel] = useState(null) // { bans, events, error } when open
  const [channelStats, setChannelStats] = useState(null) // { subscribers, ... } | { error }
  const [invites, setInvites] = useState(null)
  const [invitesLoading, setInvitesLoading] = useState(false)
  const [copiedInviteId, setCopiedInviteId] = useState('')
  const [joinRequests, setJoinRequests] = useState(null)
  const [joinRequestsLoading, setJoinRequestsLoading] = useState(false)
  const { confirm, dialog } = useConfirm()

  const isBackendGroup = chat.backend && (contact.type === 'group' || contact.type === 'channel')
  const canModeratePrivateContact = chat.backend && contact.type === 'private' && contact.id !== currentUserId
  const members = memberLoad.chatId === chat.id ? memberLoad.members : null
  const currentMember = members?.find((member) => member.id === currentUserId)
  const currentPermissions = currentMember?.permissions || contact.permissions || {}
  const canManageMembers = isBackendGroup && (
    currentPermissions.manage_members ||
    ['owner', 'admin'].includes(currentMember?.role || contact.role)
  )
  const canManageRoles = isBackendGroup && (
    currentPermissions.manage_roles ||
    (currentMember?.role || contact.role) === 'owner'
  )
  const isOwnerOrAdmin = canManageMembers || canManageRoles
  const membersLoading = Boolean(isBackendGroup && onLoadGroupMembers && memberLoad.chatId !== chat.id)
  const callHistoryLoading = Boolean(chat.backend && onLoadCallHistory && callHistoryLoad.chatId !== chat.id)

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

  useEffect(() => {
    if (!chat.backend || !onLoadCallHistory) return undefined

    let cancelled = false
    onLoadCallHistory(chat.id)
      .then((calls) => {
        if (!cancelled) setCallHistoryLoad({ chatId: chat.id, calls: calls || [] })
      })
      .catch(() => {
        if (!cancelled) setCallHistoryLoad({ chatId: chat.id, calls: [] })
      })

    return () => { cancelled = true }
  }, [chat.backend, chat.id, onLoadCallHistory])

  async function loadServerMedia(before = null) {
    if (!chat.backend) return
    const isFirst = before === null
    setServerMedia((current) => ({
      ...current,
      chatId: chat.id,
      loading: true,
      ...(isFirst ? { items: null, hasMore: false, nextBefore: null } : {}),
    }))
    try {
      const kinds = sharedTab === 'media' ? ['image', 'video']
        : sharedTab === 'files' ? ['file']
        : sharedTab === 'audio' ? ['voice', 'audio']
        : null
      const data = await getChatMedia(chat.id, { kinds: kinds || undefined, before, limit: 40 })
      setServerMedia((current) => ({
        chatId: chat.id,
        items: isFirst ? data.items : [...(current.items || []), ...data.items],
        hasMore: data.hasMore,
        nextBefore: data.nextBefore,
        loading: false,
      }))
    } catch {
      setServerMedia((current) => ({ ...current, loading: false }))
    }
  }

  useEffect(() => {
    if (!chat.backend) return
    loadServerMedia(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.id, chat.backend, sharedTab])

  async function toggleAdminPanel() {
    if (adminPanel) {
      setAdminPanel(null)
      return
    }
    setAdminPanel({ loading: true })
    try {
      const [bansPayload, logPayload] = await Promise.all([
        getChatBans(chat.id),
        getChatAdminLog(chat.id),
      ])
      setAdminPanel({ bans: bansPayload.bans || [], events: logPayload.events || [] })
    } catch (error) {
      setAdminPanel({ error: error.message || t('pp.adminLoadFailed') })
    }
  }

  async function unbanUser(userId) {
    try {
      await unbanChatMember(chat.id, userId)
      setAdminPanel((current) =>
        current?.bans
          ? { ...current, bans: current.bans.filter((ban) => ban.userId !== userId) }
          : current,
      )
    } catch (error) {
      setAdminPanel((current) => (current ? { ...current, error: error.message } : current))
    }
  }

  async function toggleChannelStats() {
    if (channelStats) {
      setChannelStats(null)
      return
    }
    setChannelStats({ loading: true })
    try {
      setChannelStats(await getChannelStats(chat.id))
    } catch (error) {
      setChannelStats({ error: error.message || t('pp.statsLoadFailed') })
    }
  }

  async function loadInvites() {
    if (!isBackendGroup || invitesLoading) return
    setInvitesLoading(true)
    try {
      const data = await getChatInvites(chat.id)
      setInvites(data.links || [])
    } catch {
      setInvites([])
    } finally {
      setInvitesLoading(false)
    }
  }

  async function handleCreateInvite() {
    try {
      const data = await createChatInvite(chat.id, { name: '' })
      setInvites((current) => [data, ...(current || [])])
    } catch {
      // toast shown by App.jsx
    }
  }

  async function handleRevokeInvite(inviteId) {
    if (!await confirm('Revoke this invite link?')) return
    try {
      await revokeChatInvite(chat.id, inviteId)
      setInvites((current) => (current || []).filter((item) => item.id !== inviteId))
    } catch {
      // toast shown by App.jsx
    }
  }

  async function loadJoinRequests() {
    if (!isBackendGroup || joinRequestsLoading) return
    setJoinRequestsLoading(true)
    try {
      const data = await getChatJoinRequests(chat.id)
      setJoinRequests(data.requests || [])
    } catch {
      setJoinRequests([])
    } finally {
      setJoinRequestsLoading(false)
    }
  }

  async function handleJoinRequest(userId, approved) {
    try {
      await reviewChatJoinRequest(chat.id, userId, approved)
      setJoinRequests((current) => (current || []).filter((r) => r.userId !== userId))
    } catch {
      // toast shown by App.jsx
    }
  }

  function copyInviteLink(link) {
    const url = `${window.location.origin}/join/${link.token}`
    navigator.clipboard.writeText(url).catch(() => {})
    setCopiedInviteId(link.id)
    window.setTimeout(() => setCopiedInviteId(''), 2000)
  }

  function memberName(userId) {
    if (!userId) return '—'
    if (userId === currentUserId) return 'You'
    return (
      members?.find((member) => member.id === userId)?.name ||
      contacts.find((item) => item.id === userId)?.name ||
      t('pp.member')
    )
  }

  const title =
    contact.type === 'group' ? t('pp.groupProfile') :
    contact.type === 'channel' ? t('pp.channelProfile') :
    t('pp.contactProfile')

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
        .filter((message) =>
          message.media &&
          !message.deleted &&
          !message.media.decryptFailed &&
          ['image', 'video'].includes(message.media.kind),
        )
        .map((message) => ({
          ...message.media,
          messageId: message.id,
          time: message.time,
        })),
    [messages],
  )
  const sharedFiles = useMemo(
    () =>
      messages
        .filter((message) =>
          message.media &&
          !message.deleted &&
          !message.media.decryptFailed &&
          message.media.kind === 'file',
        )
        .map((message) => ({
          ...message.media,
          messageId: message.id,
          time: message.time,
        })),
    [messages],
  )
  const sharedAudio = useMemo(
    () =>
      messages
        .filter((message) =>
          message.media &&
          !message.deleted &&
          !message.media.decryptFailed &&
          ['voice', 'audio'].includes(message.media.kind),
        )
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
    if (!await confirm('Remove this member?')) return
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

  function patchLoadedMember(userId, patch) {
    setMemberLoad((current) => (
      current.chatId === chat.id
        ? {
            ...current,
            members: (current.members || []).map((member) =>
              member.id === userId ? { ...member, ...patch } : member,
            ),
          }
        : current
    ))
  }

  async function handleRoleChange(member, role) {
    if (!onUpdateGroupMemberRole || role === member.role) return
    setSavingMemberId(member.id)
    try {
      const response = await onUpdateGroupMemberRole(chat.id, member.id, {
        role,
        permissions: {},
      })
      if (onLoadGroupMembers) {
        const list = await onLoadGroupMembers(chat.id)
        setMemberLoad({ chatId: chat.id, members: list || [] })
      } else {
        patchLoadedMember(member.id, {
          role: response.role || role,
          permissions: response.permissions || {},
        })
      }
    } finally {
      setSavingMemberId('')
    }
  }

  async function handlePermissionChange(member, permission, value) {
    if (!onUpdateGroupMemberPermissions) return
    const permissions = {
      ...(member.permissions || {}),
      [permission]: value,
    }
    setSavingMemberId(member.id)
    try {
      const response = await onUpdateGroupMemberPermissions(chat.id, member.id, permissions)
      patchLoadedMember(member.id, {
        permissions: response.permissions || permissions,
      })
    } finally {
      setSavingMemberId('')
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
    <>
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
              placeholder={t('pp.groupName')}
              maxLength={64}
            />
            <button type="submit">{t('pp.save')}</button>
            <button type="button" onClick={() => setEditingTitle(false)}>{t('chat.cancel')}</button>
          </form>
        ) : (
          <h2
            className={isBackendGroup && isOwnerOrAdmin ? 'editable-title' : ''}
            onClick={() => isBackendGroup && isOwnerOrAdmin && setEditingTitle(true)}
            title={isBackendGroup && isOwnerOrAdmin ? t('pp.clickToRename') : ''}
          >
            {contact.name}
          </h2>
        )}
        {contact.customStatus && <p className="profile-custom-status">{contact.customStatus}</p>}
        <p className={contact.status === 'online' ? 'online-text' : ''}>{contact.lastSeen}</p>
      </div>

      <dl className="profile-data">
        {contact.customStatus && (
          <div>
            <dt>{t('pp.status')}</dt>
            <dd>{contact.customStatus}</dd>
          </div>
        )}
        {contact.username && (
          <div>
            <dt>{t('pp.username')}</dt>
            <dd>{contact.username}</dd>
          </div>
        )}
        {contact.phone && (
          <div>
            <dt>{t('pp.phone')}</dt>
            <dd>{contact.phone}</dd>
          </div>
        )}
        {contact.bio && (
          <div>
            <dt>{t('pp.about')}</dt>
            <dd>{contact.bio}</dd>
          </div>
        )}
        <div>
          <dt>{t('pp.type')}</dt>
          <dd>{contact.type || 'private'}</dd>
        </div>
        {contact.type === 'channel' && (
          <div>
            <dt>{t('pp.subscribers')}</dt>
            <dd>{contact.subscribers || 0}</dd>
          </div>
        )}
      </dl>

      <FocusSchedule messages={messages} contact={contact} currentUserId={currentUserId} />

      {/* Group members section */}
      {(contact.type === 'group' || contact.type === 'channel') && (
        <section className="group-members-section">
          <div className="group-members-header">
            <strong><Users size={15} /> {t('pp.members')}</strong>
            {isBackendGroup && canManageMembers && (
              <button
                className="add-member-btn"
                onClick={() => setAddingMember((v) => !v)}
                title={t('pp.addMember')}
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
                placeholder={t('pp.userIdToAdd')}
              />
              <button type="submit">{t('pp.add')}</button>
              <button type="button" onClick={() => setAddingMember(false)}>X</button>
            </form>
          )}

          {membersLoading ? (
            <div className="members-loading"><Loader2 size={16} className="spin" /> {t('pp.loading')}</div>
          ) : members ? (
            <ul className="members-list">
              {members.map((m) => (
                <li key={m.id} className="member-item">
                  <span className="member-name">
                    {m.name}
                    <small className="member-role">{m.role}</small>
                  </span>
                  <div className="member-admin-controls">
                    {canManageRoles && m.id !== currentUserId && (
                      <>
                        <label className="member-role-select">
                          <select
                            value={m.role || 'member'}
                            onChange={(event) => handleRoleChange(m, event.target.value)}
                            disabled={savingMemberId === m.id}
                            aria-label={`Change role for ${m.name}`}
                          >
                            {roleOptions.map((role) => (
                              <option key={role} value={role}>{role}</option>
                            ))}
                          </select>
                        </label>
                        <details className="member-permissions">
                          <summary><Shield size={13} /> {t('pp.rights')}</summary>
                          <div>
                            {permissionOptions.map(([key, label]) => (
                              <label key={key}>
                                <input
                                  type="checkbox"
                                  checked={Boolean(m.permissions?.[key])}
                                  disabled={savingMemberId === m.id}
                                  onChange={(event) => handlePermissionChange(m, key, event.target.checked)}
                                />
                                <span>{label}</span>
                              </label>
                            ))}
                          </div>
                        </details>
                      </>
                    )}
                    {savingMemberId === m.id && <Loader2 size={14} className="spin member-saving" />}
                    {canManageMembers && m.id !== currentUserId && (
                      <button
                        className="remove-member-btn"
                        onClick={() => handleRemoveMember(m.id)}
                        title={t('pp.removeMember')}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : !isBackendGroup ? (
            <p className="members-local">{memberNames.join(', ') || t('pp.noMembers')}</p>
          ) : null}
        </section>
      )}

      <div className="panel-actions">
        <button onClick={onTogglePin}>
          <Pin size={17} /> {chat.pinned ? t('chat.unpin') : t('chat.pin')}
        </button>
        <button onClick={onToggleMute}>
          {chat.muted ? <Bell size={17} /> : <BellOff size={17} />}
          {chat.muted ? t('chat.unmute') : t('chat.mute')}
        </button>
        <button onClick={onArchive}>
          <Archive size={17} /> {chat.archived ? t('chat.unarchive') : t('chat.archive')}
        </button>
        {isBackendGroup && contact.type === 'group' && isOwnerOrAdmin && (
          <button onClick={toggleAdminPanel} className={adminPanel ? 'active' : ''}>
            <Shield size={17} /> {t('pp.adminSettings')}
          </button>
        )}
        {isBackendGroup && contact.type === 'channel' && isOwnerOrAdmin && (
          <button onClick={toggleChannelStats} className={channelStats ? 'active' : ''}>
            <Users size={17} /> {t('pp.statistics')}
          </button>
        )}
        {canModeratePrivateContact && (
          <>
            <button onClick={() => onReportUser?.(contact.id)}>
              <Flag size={17} /> {t('pp.reportUser')}
            </button>
            {contact.blockedByMe ? (
              <button onClick={() => onUnblockUser?.(contact.id)}>
                <Ban size={17} /> {t('pp.unblockUser')}
              </button>
            ) : (
              <button className="danger-profile-action" onClick={() => onBlockUser?.(contact.id)}>
                <Ban size={17} /> {t('pp.blockUser')}
              </button>
            )}
          </>
        )}
      </div>

      {adminPanel && (
        <section className="admin-panel-section">
          <div className="group-members-header">
            <strong><Shield size={15} /> {t('pp.adminSettings')}</strong>
          </div>
          {adminPanel.loading ? (
            <div className="members-loading"><Loader2 size={16} className="spin" /> {t('pp.loading')}</div>
          ) : adminPanel.error ? (
            <p className="shared-empty">{adminPanel.error}</p>
          ) : (
            <>
              <p className="admin-panel-subtitle">{t('pp.bannedUsers')}</p>
              {adminPanel.bans.length ? (
                <ul className="admin-ban-list">
                  {adminPanel.bans.map((ban) => (
                    <li key={ban.userId}>
                      <span>
                        <strong>{ban.user?.name || memberName(ban.userId)}</strong>
                        <small>
                          {ban.reason || t('pp.noReason')}
                          {ban.expiresAt ? ` · until ${formatCallTime(ban.expiresAt)}` : ''}
                        </small>
                      </span>
                      <button type="button" onClick={() => unbanUser(ban.userId)}>{t('pp.unban')}</button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="shared-empty">{t('pp.noBans')}</p>
              )}
              <p className="admin-panel-subtitle">{t('pp.recentAdminActions')}</p>
              {adminPanel.events.length ? (
                <ul className="admin-log-list">
                  {adminPanel.events.slice(0, 12).map((event) => (
                    <li key={event.id}>
                      <span>
                        <strong>{event.action.replace(/[_:]/g, ' ')}</strong>
                        <small>
                          {memberName(event.actorUserId)}
                          {event.targetUserId ? ` → ${memberName(event.targetUserId)}` : ''}
                        </small>
                      </span>
                      <small>{formatCallTime(event.createdAt)}</small>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="shared-empty">{t('pp.noAdminActions')}</p>
              )}
            </>
          )}
        </section>
      )}

      {channelStats && (
        <section className="admin-panel-section">
          <div className="group-members-header">
            <strong><Users size={15} /> {t('pp.channelStats')}</strong>
          </div>
          {channelStats.loading ? (
            <div className="members-loading"><Loader2 size={16} className="spin" /> {t('pp.loading')}</div>
          ) : channelStats.error ? (
            <p className="shared-empty">{channelStats.error}</p>
          ) : (
            <ul className="channel-stats-grid">
              <li><strong>{channelStats.subscribers}</strong><small>{t('pp.subscribers')}</small></li>
              <li><strong>{channelStats.posts}</strong><small>{t('pp.posts')}</small></li>
              <li><strong>{channelStats.views}</strong><small>{t('pp.views')}</small></li>
              <li><strong>{channelStats.reposts}</strong><small>{t('pp.reposts')}</small></li>
            </ul>
          )}
        </section>
      )}

      {chat.backend && (
        <section className="call-history-section">
          <div className="group-members-header">
            <strong><Phone size={15} /> {t('pp.calls')}</strong>
          </div>
          {callHistoryLoading ? (
            <div className="members-loading"><Loader2 size={16} className="spin" /> {t('pp.loading')}</div>
          ) : callHistoryLoad.calls?.length ? (
            <ul className="call-history-list">
              {callHistoryLoad.calls.slice(0, 8).map((item) => {
                const names = (item.participants || [])
                  .filter((participant) => !participant.self)
                  .map((participant) => participant.name)
                  .slice(0, 3)
                  .join(', ')
                return (
                  <li key={item.id}>
                    <span>
                      <strong>{item.kind === 'video' ? t('chat.videoCall') : t('chat.audioCall')}</strong>
                      <small>{names || contact.name}</small>
                    </span>
                    <span>
                      <strong>{callStatusLabel(item)}</strong>
                      <small>{formatCallTime(item.createdAt)}</small>
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="shared-empty">{t('pp.noCalls')}</p>
          )}
        </section>
      )}

      {isBackendGroup && isOwnerOrAdmin && (
        <section className="invite-links-section">
          <div className="group-members-header">
            <strong><LinkIcon size={15} /> {t('pp.inviteLinks')}</strong>
            <button
              className="add-member-btn"
              title={t('pp.createInvite')}
              onClick={invites === null ? async () => { await loadInvites(); handleCreateInvite() } : handleCreateInvite}
            >
              <Plus size={15} />
            </button>
          </div>
          {invites === null && !invitesLoading && (
            <button className="load-invites-btn" onClick={loadInvites}>
              {t('pp.showInviteLinks')}
            </button>
          )}
          {invitesLoading && <div className="members-loading"><Loader2 size={16} className="spin" /></div>}
          {invites !== null && (
            <ul className="invite-links-list">
              {invites.length === 0 && <li className="shared-empty">{t('pp.noInviteLinks')}</li>}
              {invites.map((link) => {
                const url = `${window.location.origin}/join/${link.token}`
                return (
                  <li key={link.id} className="invite-link-row">
                    <div className="invite-link-body">
                      <span className="invite-link-url">{url}</span>
                      {link.usageCount !== undefined && (
                        <small>{link.usageCount} {t('pp.uses')}{link.usageLimit ? ` / ${link.usageLimit}` : ''}</small>
                      )}
                    </div>
                    <button
                      className="invite-copy-btn"
                      onClick={() => copyInviteLink(link)}
                      title={t('pp.copyLink')}
                    >
                      {copiedInviteId === link.id ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                    <button
                      className="remove-member-btn"
                      onClick={() => handleRevokeInvite(link.id)}
                      title={t('pp.revokeLink')}
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      )}

      {isBackendGroup && isOwnerOrAdmin && (
        <section className="invite-links-section">
          <div className="group-members-header">
            <strong><Users size={15} /> Join Requests</strong>
            <button
              className="add-member-btn"
              title="Refresh"
              onClick={loadJoinRequests}
              disabled={joinRequestsLoading}
            >
              <Loader2 size={15} className={joinRequestsLoading ? 'spin' : ''} />
            </button>
          </div>
          {joinRequests === null && !joinRequestsLoading && (
            <button className="load-invites-btn" onClick={loadJoinRequests}>
              Show join requests
            </button>
          )}
          {joinRequestsLoading && (
            <div className="members-loading"><Loader2 size={16} className="spin" /></div>
          )}
          {joinRequests !== null && (
            <ul className="join-requests-list">
              {joinRequests.length === 0 && (
                <li className="shared-empty">No pending join requests</li>
              )}
              {joinRequests.map((req) => (
                <li key={req.userId} className="join-request-row">
                  <div className="join-request-info">
                    <strong>{req.user?.name || req.userId}</strong>
                    {req.message && <small>{req.message}</small>}
                  </div>
                  <div className="join-request-actions">
                    <button
                      className="join-approve-btn"
                      title="Approve"
                      onClick={() => handleJoinRequest(req.userId, true)}
                    >
                      <Check size={14} />
                    </button>
                    <button
                      className="remove-member-btn"
                      title="Decline"
                      onClick={() => handleJoinRequest(req.userId, false)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="shared-panel">
        <div className="shared-tabs">
          <button className={sharedTab === 'media' ? 'active' : ''} onClick={() => setSharedTab('media')}>
            <Image size={15} /> {t('pp.media')}
          </button>
          <button className={sharedTab === 'files' ? 'active' : ''} onClick={() => setSharedTab('files')}>
            <FileText size={15} /> {t('pp.files')}
          </button>
          <button className={sharedTab === 'audio' ? 'active' : ''} onClick={() => setSharedTab('audio')}>
            <Music size={15} /> {t('pp.voice')}
          </button>
          <button className={sharedTab === 'links' ? 'active' : ''} onClick={() => setSharedTab('links')}>
            <LinkIcon size={15} /> {t('pp.links')}
          </button>
        </div>

        {sharedTab === 'media' && (() => {
          const items = chat.backend
            ? (serverMedia.chatId === chat.id ? serverMedia.items : null)
            : sharedMedia
          const loading = chat.backend && serverMedia.loading && !items
          return (
            <div className="shared-media-grid">
              {loading && <p className="shared-empty"><Loader2 size={16} className="spin" /> Loading…</p>}
              {(items || []).map((media) => (
                <button key={`${media.messageId}-${media.id}`} onClick={() => onOpenMedia(media)}>
                  {media.kind === 'image' ? (
                    <img src={media.url} alt={media.name || 'Shared media'} loading="lazy" />
                  ) : (
                    <>
                      <video src={media.url} preload="metadata" muted />
                      <span><Play size={18} fill="currentColor" /></span>
                    </>
                  )}
                </button>
              ))}
              {!loading && items?.length === 0 && <p className="shared-empty">{t('pp.noSharedMedia')}</p>}
              {chat.backend && serverMedia.hasMore && (
                <button className="shared-load-more" onClick={() => loadServerMedia(serverMedia.nextBefore)}>
                  {serverMedia.loading ? <Loader2 size={14} className="spin" /> : 'Load more'}
                </button>
              )}
            </div>
          )
        })()}

        {sharedTab === 'files' && (() => {
          const items = chat.backend
            ? (serverMedia.chatId === chat.id ? serverMedia.items : null)
            : sharedFiles
          const loading = chat.backend && serverMedia.loading && !items
          return (
            <div className="shared-links-list">
              {loading && <p className="shared-empty"><Loader2 size={16} className="spin" /> Loading…</p>}
              {(items || []).map((file) => (
                <a key={`${file.messageId}-${file.id}`} href={file.url} download={file.name || 'file'}>
                  <FileText size={16} />
                  <span>
                    <strong>{file.name || 'File'}</strong>
                    <small>{file.createdAt ? formatMessageTime(file.createdAt) : formatMessageTime(file.time)}</small>
                  </span>
                </a>
              ))}
              {!loading && items?.length === 0 && <p className="shared-empty">{t('pp.noSharedFiles')}</p>}
              {chat.backend && serverMedia.hasMore && (
                <button className="shared-load-more" onClick={() => loadServerMedia(serverMedia.nextBefore)}>
                  {serverMedia.loading ? <Loader2 size={14} className="spin" /> : 'Load more'}
                </button>
              )}
            </div>
          )
        })()}

        {sharedTab === 'audio' && (() => {
          const items = chat.backend
            ? (serverMedia.chatId === chat.id ? serverMedia.items : null)
            : sharedAudio
          const loading = chat.backend && serverMedia.loading && !items
          return (
            <div className="shared-links-list">
              {loading && <p className="shared-empty"><Loader2 size={16} className="spin" /> Loading…</p>}
              {(items || []).map((audio) => (
                <a key={`${audio.messageId}-${audio.id}`} href={audio.url} download={audio.name || 'audio'}>
                  <Music size={16} />
                  <span>
                    <strong>{audio.name || (audio.kind === 'voice' ? t('pp.voiceMessage') : t('pp.audio'))}</strong>
                    <small>{audio.createdAt ? formatMessageTime(audio.createdAt) : formatMessageTime(audio.time)}</small>
                  </span>
                </a>
              ))}
              {!loading && items?.length === 0 && <p className="shared-empty">{t('pp.noSharedAudio')}</p>}
              {chat.backend && serverMedia.hasMore && (
                <button className="shared-load-more" onClick={() => loadServerMedia(serverMedia.nextBefore)}>
                  {serverMedia.loading ? <Loader2 size={14} className="spin" /> : 'Load more'}
                </button>
              )}
            </div>
          )
        })()}

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
            {!sharedLinks.length && <p className="shared-empty">{t('pp.noSharedLinks')}</p>}
          </div>
        )}
      </section>
    </aside>
    {dialog}
    </>
  )
}
