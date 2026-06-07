import { useRef, useState } from 'react'
import {
  Archive,
  ArrowLeft,
  Bell,
  BellOff,
  Brush,
  Camera,
  Check,
  Copy,
  Download,
  Folder,
  FolderPlus,
  Hash,
  ImageUp,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Menu,
  MessageCirclePlus,
  Moon,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Smartphone,
  Sun,
  LogOut,
  Trash2,
  Upload,
  UserCircle,
  Users,
  X,
  XCircle,
} from 'lucide-react'
import Avatar from './Avatar'
import ChatList from './ChatList'
import IconButton from './IconButton'
import { formatChatTime } from '../utils/formatters'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default function Sidebar({
  chats,
  chatFolders,
  selectedFolderId,
  contacts,
  user,
  settings,
  selectedChatId,
  search,
  menuOpen,
  onSearch,
  onSelectChat,
  onSelectFolder,
  onOpenCreateSpace,
  onCreateChat,
  onUpdateSettings,
  onUpdateUser,
  onResetState,
  onLogout,
  onToggleMenu,
  onTogglePin,
  onToggleMute,
  onArchiveChat,
  onCreateFolder,
  onUpdateFolder,
  onDeleteFolder,
  onToggleFolderPin,
  onExportEncryptionKey,
  onImportEncryptionKey,
  onUploadAvatar,
  onRemoveAvatar,
  onChangePassword,
  onDeleteAccount,
  onLoadSessions,
  onTerminateOtherSessions,
  onTerminateSession,
}) {
  const [menuView, setMenuView] = useState('main')
  const [contactSearch, setContactSearch] = useState('')
  const [sessions, setSessions] = useState([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [sessionsError, setSessionsError] = useState('')
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirm: '' })
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [inviteCopied, setInviteCopied] = useState(false)
  const [folderMode, setFolderMode] = useState('list')
  const [folderDraft, setFolderDraft] = useState({ id: '', title: '', chatIds: [] })
  const [folderBusy, setFolderBusy] = useState(false)
  const [folderError, setFolderError] = useState('')
  const keyImportRef = useRef(null)
  const avatarInputRef = useRef(null)

  const WALLPAPERS = ['default', 'plain', 'lavender', 'mint', 'peach', 'night']
  const inviteUsername = String(user.username || '').replace(/^@/, '')
  const inviteLink = inviteUsername
    ? `${window.location.origin}/?add=${inviteUsername}`
    : ''

  function handleAvatarChange(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > 8 * 1024 * 1024) {
      onUpdateSettings({ toast: 'Image is too large. Maximum size is 8 MB.' })
      return
    }
    onUploadAvatar(file)
  }

  async function copyInvite() {
    if (!inviteLink) return
    try {
      await navigator.clipboard.writeText(inviteLink)
      setInviteCopied(true)
      window.setTimeout(() => setInviteCopied(false), 1600)
    } catch {
      onUpdateSettings({ toast: 'Clipboard is unavailable in this browser.' })
    }
  }

  async function submitPasswordChange(event) {
    event.preventDefault()
    setPasswordError('')
    if (passwordForm.next.length < 10) {
      setPasswordError('New password must be at least 10 characters.')
      return
    }
    if (passwordForm.next !== passwordForm.confirm) {
      setPasswordError('New passwords do not match.')
      return
    }
    setPasswordBusy(true)
    try {
      await onChangePassword({ currentPassword: passwordForm.current, newPassword: passwordForm.next })
      setPasswordForm({ current: '', next: '', confirm: '' })
      setMenuView('privacy')
    } catch (error) {
      setPasswordError(error.message || 'Password was not changed.')
    } finally {
      setPasswordBusy(false)
    }
  }

  function confirmDeleteAccount() {
    const sure = window.confirm(
      'Delete your account permanently? Your messages and the chats you created will be removed. This cannot be undone.',
    )
    if (sure) onDeleteAccount()
  }

  const privateContacts = contacts.filter(
    (contact) => contact.type === 'private' && contact.status !== 'saved',
  )
  const archivedChats = chats.filter((chat) => chat.archived)
  const filteredContacts = privateContacts.filter((contact) => {
    const normalized = contactSearch.trim().toLowerCase()
    if (!normalized) return true
    return [contact.name, contact.username, contact.phone].filter(Boolean).some((value) => value.toLowerCase().includes(normalized))
  })
  const systemFolders = chatFolders?.systemFolders || []
  const customFolders = chatFolders?.folders || []
  const folderSelectableChats = chats.filter((chat) => UUID_RE.test(chat.id))
  const selectedCustomFolder = customFolders.find((folder) => folder.id === selectedFolderId)
  const selectedSystemFolder = systemFolders.find((folder) => folder.id === selectedFolderId)
  const selectedFolder = selectedCustomFolder || selectedSystemFolder || systemFolders[0]
  const normalizedChatSearch = search.trim().toLowerCase()

  function matchesSearch(chat) {
    if (!normalizedChatSearch) return true
    return [chat.contact.name, chat.contact.username, chat.lastMessageText]
      .filter(Boolean)
      .some((value) => value.toLowerCase().includes(normalizedChatSearch))
  }

  function matchesSystemFolder(chat, folderId) {
    if (folderId === 'archived') return chat.archived
    if (chat.archived) return false
    if (folderId === 'unread') return (chat.unread || 0) > 0
    if (folderId === 'personal') return chat.contact.type === 'private'
    if (folderId === 'groups') return chat.contact.type === 'group' || chat.serverType === 'group'
    if (folderId === 'channels') return chat.contact.type === 'channel' || chat.serverType === 'channel'
    return true
  }

  function recentTime(chat) {
    return chat.lastMessageTime ? new Date(chat.lastMessageTime).getTime() : 0
  }

  function chatsForCustomFolder(folder) {
    const folderChats = new Map((folder?.chats || []).map((chat) => [chat.chatId, chat]))
    return chats
      .filter((chat) => folderChats.has(chat.id) && matchesSearch(chat))
      .map((chat) => {
        const folderChat = folderChats.get(chat.id)
        return {
          ...chat,
          folderPinned: Boolean(folderChat?.pinned),
          folderPinnedAt: folderChat?.pinnedAt || null,
        }
      })
      .sort((a, b) => {
        if (a.folderPinned !== b.folderPinned) return a.folderPinned ? -1 : 1
        if (a.folderPinned && b.folderPinned) {
          return new Date(b.folderPinnedAt || 0).getTime() - new Date(a.folderPinnedAt || 0).getTime()
        }
        return recentTime(b) - recentTime(a)
      })
  }

  const visibleChats = selectedCustomFolder
    ? chatsForCustomFolder(selectedCustomFolder)
    : chats.filter((chat) => matchesSystemFolder(chat, selectedFolder?.id || 'all') && matchesSearch(chat))

  function folderCount(folder) {
    if (folder.chats) return folder.chats.length
    return chats.filter((chat) => matchesSystemFolder(chat, folder.id)).length
  }

  function closeMenu() {
    setMenuView('main')
    setContactSearch('')
    setFolderMode('list')
    setFolderError('')
    onToggleMenu()
  }

  function openCreateSpace(type) {
    setMenuView('main')
    onOpenCreateSpace(type)
  }

  function createPrivateChat(contactId) {
    onCreateChat(contactId)
    closeMenu()
  }

  function selectArchived(chatId) {
    setMenuView('main')
    setContactSearch('')
    onSelectChat(chatId)
  }

  function openMainMenu() {
    setMenuView('main')
    setContactSearch('')
    setFolderMode('list')
    setFolderError('')
    onToggleMenu()
  }

  function startCreateFolder() {
    setFolderMode('create')
    setFolderDraft({ id: '', title: '', chatIds: [] })
    setFolderError('')
  }

  function startEditFolder(folder) {
    setFolderMode('edit')
    setFolderDraft({
      id: folder.id,
      title: folder.title,
      chatIds: (folder.chats || []).map((chat) => chat.chatId),
    })
    setFolderError('')
  }

  function toggleDraftChat(chatId) {
    setFolderDraft((draft) => ({
      ...draft,
      chatIds: draft.chatIds.includes(chatId)
        ? draft.chatIds.filter((id) => id !== chatId)
        : [...draft.chatIds, chatId],
    }))
  }

  async function submitFolder(event) {
    event.preventDefault()
    setFolderError('')
    const title = folderDraft.title.trim()
    if (!title) {
      setFolderError('Folder name is required.')
      return
    }
    setFolderBusy(true)
    try {
      if (folderMode === 'edit') {
        await onUpdateFolder(folderDraft.id, { title, chatIds: folderDraft.chatIds })
      } else {
        const folder = await onCreateFolder({ title, chatIds: folderDraft.chatIds })
        onSelectFolder(folder.id)
      }
      setFolderMode('list')
      setFolderDraft({ id: '', title: '', chatIds: [] })
    } catch (error) {
      setFolderError(error.message || 'Folder was not saved.')
    } finally {
      setFolderBusy(false)
    }
  }

  async function deleteFolder(folderId) {
    const folder = customFolders.find((item) => item.id === folderId)
    const sure = window.confirm(`Delete folder "${folder?.title || 'Folder'}"? Chats and messages will stay.`)
    if (!sure) return
    setFolderBusy(true)
    setFolderError('')
    try {
      await onDeleteFolder(folderId)
      setFolderMode('list')
    } catch (error) {
      setFolderError(error.message || 'Folder was not deleted.')
    } finally {
      setFolderBusy(false)
    }
  }

  async function refreshSessions() {
    setSessionsLoading(true)
    setSessionsError('')
    try {
      const nextSessions = await onLoadSessions()
      setSessions(nextSessions)
    } catch (error) {
      setSessionsError(error.message || 'Could not load sessions.')
    } finally {
      setSessionsLoading(false)
    }
  }

  async function openSessions() {
    setMenuView('sessions')
    await refreshSessions()
  }

  async function terminateSession(sessionId) {
    setSessionsLoading(true)
    setSessionsError('')
    try {
      await onTerminateSession(sessionId)
      await refreshSessions()
    } catch (error) {
      setSessionsError(error.message || 'Could not terminate session.')
    } finally {
      setSessionsLoading(false)
    }
  }

  async function terminateOtherSessions() {
    setSessionsLoading(true)
    setSessionsError('')
    try {
      await onTerminateOtherSessions()
      await refreshSessions()
    } catch (error) {
      setSessionsError(error.message || 'Could not terminate sessions.')
    } finally {
      setSessionsLoading(false)
    }
  }

  function renderMenuHeader(title) {
    const backView = title === 'Change password'
      ? 'privacy'
      : ['Chat appearance', 'Privacy and security', 'Active sessions'].includes(title)
        ? 'settings'
        : 'main'

    return (
      <header className="drawer-page-header">
        <button onClick={() => setMenuView(backView)} aria-label="Back to menu">
          <ArrowLeft size={20} />
        </button>
        <strong>{title}</strong>
      </header>
    )
  }

  function renderMainMenu() {
    return (
      <>
        <header className="side-menu-profile">
          <button className="menu-profile-button" onClick={() => setMenuView('profile')} aria-label="Open profile">
            <div className="menu-avatar">
              <Avatar contact={user} size="md" />
            </div>
            <div>
              <strong>{user.name}</strong>
              <span>{user.username}</span>
            </div>
          </button>
          <button onClick={closeMenu} aria-label="Close menu">
            <X size={19} />
          </button>
        </header>
        <div className="side-menu-actions">
          <button onClick={() => setMenuView('contacts')}>
            <MessageCirclePlus size={19} /> New private chat
          </button>
          <button onClick={() => openCreateSpace('group')}>
            <Users size={19} /> New group
          </button>
          <button onClick={() => openCreateSpace('channel')}>
            <Hash size={19} /> New channel
          </button>
          <button onClick={() => setMenuView('profile')}>
            <UserCircle size={19} /> My profile
          </button>
          <button onClick={() => setMenuView('contacts')}>
            <Users size={19} /> Contacts
          </button>
          <button onClick={() => setMenuView('archive')}>
            <Archive size={19} /> Archived chats
          </button>
          <button onClick={() => setMenuView('folders')}>
            <Folder size={19} /> Folders
          </button>
          <button onClick={() => setMenuView('settings')}>
            <Settings size={19} /> Settings
          </button>
        </div>
        <div className="side-menu-footer">
          <Sun size={15} /> Light/dark theme in Settings <Moon size={15} />
        </div>
      </>
    )
  }

  function renderProfileMenu() {
    return (
      <>
        {renderMenuHeader('My profile')}
        <section className="drawer-profile">
          <div className="drawer-avatar-wrap">
            <Avatar contact={user} size="xl" />
            <button
              className="drawer-avatar-edit"
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              aria-label="Change profile photo"
            >
              <Camera size={16} />
            </button>
          </div>
          <input
            ref={avatarInputRef}
            className="visually-hidden"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/avif"
            onChange={handleAvatarChange}
          />
          <strong>{user.name}</strong>
          <span>{user.username}</span>
          <div className="drawer-avatar-actions">
            <button type="button" onClick={() => avatarInputRef.current?.click()}>
              <ImageUp size={15} /> Upload photo
            </button>
            <button type="button" className="ghost-danger" onClick={onRemoveAvatar}>
              <Trash2 size={15} /> Remove
            </button>
          </div>
        </section>
        <div className="drawer-fields">
          <label>
            <span>Name</span>
            <input value={user.name} onChange={(event) => onUpdateUser({ name: event.target.value })} />
          </label>
          <label>
            <span>Username</span>
            <input value={user.username} onChange={(event) => onUpdateUser({ username: event.target.value })} />
          </label>
          <label>
            <span>Bio</span>
            <input value={user.bio} onChange={(event) => onUpdateUser({ bio: event.target.value })} />
          </label>
          <div className="drawer-invite">
            <span>Invite link</span>
            <div className="drawer-invite-row">
              <input readOnly value={inviteLink} onFocus={(event) => event.target.select()} />
              <button type="button" onClick={copyInvite} aria-label="Copy invite link">
                {inviteCopied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
            <small>Share this link so people can start a private chat with you.</small>
          </div>
        </div>
      </>
    )
  }

  function renderContactsMenu() {
    return (
      <>
        {renderMenuHeader('Contacts')}
        <label className="drawer-search">
          <Search size={17} />
          <input value={contactSearch} onChange={(event) => setContactSearch(event.target.value)} placeholder="Search people" />
        </label>
        <div className="drawer-list">
          {filteredContacts.map((contact) => (
            <button key={contact.id} className="drawer-contact" onClick={() => createPrivateChat(contact.id)}>
              <Avatar contact={contact} />
              <span>
                <strong>{contact.name}</strong>
                <small>{contact.lastSeen}</small>
              </span>
            </button>
          ))}
          {!filteredContacts.length && <p className="drawer-empty">No contacts found.</p>}
        </div>
      </>
    )
  }

  function renderArchiveMenu() {
    return (
      <>
        {renderMenuHeader('Archived chats')}
        <div className="drawer-list">
          {archivedChats.map((chat) => (
            <button key={chat.id} className="drawer-archive-chat" onClick={() => selectArchived(chat.id)}>
              <Avatar contact={chat.contact} />
              <span>
                <strong>{chat.contact.name}</strong>
                <small>{chat.lastMessageText || 'No messages yet'}</small>
              </span>
              <time>{formatChatTime(chat.lastMessageTime)}</time>
            </button>
          ))}
          {!archivedChats.length && <p className="drawer-empty">No archived chats.</p>}
        </div>
      </>
    )
  }

  function renderFolderForm() {
    return (
      <form className="drawer-fields folder-editor" onSubmit={submitFolder}>
        <label>
          <span>Name</span>
          <input
            value={folderDraft.title}
            onChange={(event) => setFolderDraft((draft) => ({ ...draft, title: event.target.value }))}
            maxLength={48}
            autoFocus
          />
        </label>
        <div className="folder-chat-picker">
          <span>Chats</span>
          <div>
            {folderSelectableChats.map((chat) => (
              <label key={chat.id} className="folder-chat-option">
                <input
                  type="checkbox"
                  checked={folderDraft.chatIds.includes(chat.id)}
                  onChange={() => toggleDraftChat(chat.id)}
                />
                <Avatar contact={chat.contact} size="sm" />
                <span>
                  <strong>{chat.contact.name}</strong>
                  <small>{chat.lastMessageText || chat.contact.lastSeen || 'No messages yet'}</small>
                </span>
              </label>
            ))}
            {!folderSelectableChats.length && <p className="drawer-empty">No server chats available.</p>}
          </div>
        </div>
        {folderError && <p className="drawer-empty session-error">{folderError}</p>}
        <div className="folder-editor-actions">
          <button type="button" onClick={() => setFolderMode('list')} disabled={folderBusy}>
            Cancel
          </button>
          <button className="primary-button" type="submit" disabled={folderBusy}>
            {folderBusy ? 'Saving...' : 'Save folder'}
          </button>
        </div>
      </form>
    )
  }

  function renderFoldersMenu() {
    return (
      <>
        {renderMenuHeader('Folders')}
        <div className="folder-menu-header">
          <strong>{folderMode === 'edit' ? 'Edit folder' : folderMode === 'create' ? 'New folder' : 'Chat folders'}</strong>
          {folderMode === 'list' && (
            <button type="button" onClick={startCreateFolder}>
              <FolderPlus size={16} /> New
            </button>
          )}
        </div>

        {folderMode !== 'list' ? (
          renderFolderForm()
        ) : (
          <>
            <section className="folder-section">
              <span>System</span>
              <div className="folder-system-grid">
                {systemFolders.map((folder) => (
                  <button
                    key={folder.id}
                    className={selectedFolderId === folder.id ? 'active' : ''}
                    onClick={() => {
                      onSelectFolder(folder.id)
                      closeMenu()
                    }}
                  >
                    <span>{folder.title}</span>
                    <small>{folderCount(folder)}</small>
                  </button>
                ))}
              </div>
            </section>

            <section className="folder-section">
              <span>Custom</span>
              <div className="drawer-list folder-manager-list">
                {customFolders.map((folder) => (
                  <article key={folder.id} className="folder-manager-row">
                    <button
                      type="button"
                      onClick={() => {
                        onSelectFolder(folder.id)
                        closeMenu()
                      }}
                    >
                      <Folder size={18} />
                      <span>
                        <strong>{folder.title}</strong>
                        <small>{folder.chats.length} chats</small>
                      </span>
                    </button>
                    <button type="button" onClick={() => startEditFolder(folder)} title="Edit folder">
                      <Pencil size={15} />
                    </button>
                    <button
                      type="button"
                      className="danger-folder-button"
                      onClick={() => deleteFolder(folder.id)}
                      title="Delete folder"
                    >
                      <Trash2 size={15} />
                    </button>
                  </article>
                ))}
                {!customFolders.length && <p className="drawer-empty">No custom folders yet.</p>}
              </div>
            </section>
            {folderError && <p className="drawer-empty session-error">{folderError}</p>}
          </>
        )}
      </>
    )
  }

  function renderSettingsMenu() {
    return (
      <>
        {renderMenuHeader('Settings')}
        <div className="drawer-fields">
          <div className="drawer-setting-row">
            <span>Theme</span>
            <div className="drawer-segmented">
              <button className={settings.theme === 'light' ? 'active' : ''} onClick={() => onUpdateSettings({ theme: 'light' })}>
                <Sun size={16} /> Light
              </button>
              <button className={settings.theme === 'dark' ? 'active' : ''} onClick={() => onUpdateSettings({ theme: 'dark' })}>
                <Moon size={16} /> Dark
              </button>
            </div>
          </div>
          <label className="drawer-toggle">
            <span>Notifications</span>
            <input
              type="checkbox"
              checked={settings.notifications}
              onChange={(event) => onUpdateSettings({ notifications: event.target.checked })}
            />
          </label>
          <label className="drawer-toggle">
            <span>Message sound</span>
            <input
              type="checkbox"
              checked={settings.sound !== false}
              onChange={(event) => onUpdateSettings({ sound: event.target.checked })}
            />
          </label>
        </div>
        <div className="drawer-settings-list">
          <button onClick={() => setMenuView('privacy')}>
            <LockKeyhole size={18} /> Privacy and security
          </button>
          <button onClick={openSessions}>
            <Smartphone size={18} /> Devices
          </button>
          <button onClick={() => setMenuView('appearance')}>
            <Brush size={18} /> Chat appearance
          </button>
          <button onClick={() => setMenuView('folders')}>
            <Folder size={18} /> Folders
          </button>
          <button onClick={() => onUpdateSettings({ toast: settings.sound !== false ? 'Message sound is on.' : 'Message sound is off.' })}>
            {settings.notifications ? <Bell size={18} /> : <BellOff size={18} />} Notifications
          </button>
          <button className="danger-menu-action" onClick={onResetState}>
            <RotateCcw size={18} /> Reset local data
          </button>
          <button className="danger-menu-action" onClick={confirmDeleteAccount}>
            <Trash2 size={18} /> Delete account
          </button>
          <button className="danger-menu-action" onClick={onLogout}>
            <LogOut size={18} /> Log out
          </button>
        </div>
      </>
    )
  }

  function renderPrivacyMenu() {
    return (
      <>
        {renderMenuHeader('Privacy and security')}
        <div className="drawer-settings-list">
          <button onClick={onExportEncryptionKey}>
            <Download size={18} /> Export encryption key
          </button>
          <button onClick={() => keyImportRef.current?.click()}>
            <Upload size={18} /> Import encryption key
          </button>
          <input
            ref={keyImportRef}
            className="visually-hidden"
            type="file"
            accept="application/json,.json,.astrakey"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) onImportEncryptionKey(file)
            }}
          />
          <button onClick={() => setMenuView('password')}>
            <KeyRound size={18} /> Change password
          </button>
          <button onClick={() => onUpdateSettings({ toast: 'Passwords are hashed in the database. Messages and media use local encryption keys.' })}>
            <KeyRound size={18} /> Encryption status
          </button>
          <button onClick={openSessions}>
            <Smartphone size={18} /> Active sessions
          </button>
        </div>
        <p className="appearance-privacy-note">
          Keep this key private. It restores access to encrypted messages and media
          for this account on another browser.
        </p>
      </>
    )
  }

  function renderSessionsMenu() {
    return (
      <>
        {renderMenuHeader('Active sessions')}
        <div className="drawer-settings-list session-actions">
          <button onClick={refreshSessions} disabled={sessionsLoading}>
            {sessionsLoading ? <LoaderCircle className="send-spinner" size={18} /> : <Smartphone size={18} />}
            Refresh sessions
          </button>
          <button className="danger-menu-action" onClick={terminateOtherSessions} disabled={sessionsLoading}>
            <XCircle size={18} /> Terminate other sessions
          </button>
        </div>

        {sessionsError && <p className="drawer-empty session-error">{sessionsError}</p>}

        <div className="drawer-list session-list">
          {sessions.map((session) => (
            <article key={session.id} className="session-card">
              <div>
                <strong>{session.device}</strong>
                <small>{session.current ? 'Current session' : `Last active ${new Date(session.lastSeenAt).toLocaleString()}`}</small>
                <small>{session.ipAddress || 'IP unavailable'}</small>
              </div>
              {!session.current && (
                <button onClick={() => terminateSession(session.id)} disabled={sessionsLoading}>
                  Terminate
                </button>
              )}
            </article>
          ))}
          {!sessionsLoading && !sessions.length && <p className="drawer-empty">No active sessions.</p>}
        </div>

        <p className="appearance-privacy-note">
          Ending a session removes its server token. Local encryption keys stored in
          that browser are not deleted remotely.
        </p>
      </>
    )
  }

  function renderPasswordMenu() {
    return (
      <>
        {renderMenuHeader('Change password')}
        <form className="drawer-fields" onSubmit={submitPasswordChange}>
          <label>
            <span>Current password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={passwordForm.current}
              onChange={(event) => setPasswordForm((form) => ({ ...form, current: event.target.value }))}
              required
            />
          </label>
          <label>
            <span>New password</span>
            <input
              type="password"
              autoComplete="new-password"
              minLength={10}
              value={passwordForm.next}
              onChange={(event) => setPasswordForm((form) => ({ ...form, next: event.target.value }))}
              required
            />
          </label>
          <label>
            <span>Repeat new password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={passwordForm.confirm}
              onChange={(event) => setPasswordForm((form) => ({ ...form, confirm: event.target.value }))}
              required
            />
          </label>
          {passwordError && <p className="drawer-empty session-error">{passwordError}</p>}
          <button className="primary-button drawer-password-submit" type="submit" disabled={passwordBusy}>
            {passwordBusy ? 'Saving…' : 'Update password'}
          </button>
        </form>
        <p className="appearance-privacy-note">
          A new password keeps this session active and signs out all your other devices.
        </p>
      </>
    )
  }

  function renderAppearanceMenu() {
    const wordStream = settings.wordStream

    function updateWordStream(patch) {
      onUpdateSettings({
        wordStream: {
          ...wordStream,
          ...patch,
        },
      })
    }

    return (
      <>
        {renderMenuHeader('Chat appearance')}
        <div className="drawer-fields appearance-settings">
          <div className="drawer-setting-row drawer-wallpaper">
            <span>Chat wallpaper</span>
            <div className="wallpaper-grid">
              {WALLPAPERS.map((bg) => (
                <button
                  key={bg}
                  type="button"
                  className={`wallpaper-swatch wallpaper-${bg} ${
                    (settings.chatBackground || 'default') === bg ? 'active' : ''
                  }`}
                  onClick={() => onUpdateSettings({ chatBackground: bg })}
                  aria-label={`${bg} wallpaper`}
                  title={bg}
                />
              ))}
            </div>
          </div>
          <label className="drawer-toggle appearance-master-toggle">
            <span>Live word background</span>
            <input
              type="checkbox"
              checked={wordStream.enabled}
              onChange={(event) => updateWordStream({ enabled: event.target.checked })}
            />
          </label>

          <label className="drawer-range">
            <span>
              Speed <output>{wordStream.speed.toFixed(2)}x</output>
            </span>
            <input
              type="range"
              min="0.5"
              max="2.5"
              step="0.25"
              value={wordStream.speed}
              onChange={(event) => updateWordStream({ speed: Number(event.target.value) })}
            />
          </label>

          <label className="drawer-range">
            <span>
              Lines <output>{wordStream.density}</output>
            </span>
            <input
              type="range"
              min="3"
              max="12"
              step="1"
              value={wordStream.density}
              onChange={(event) => updateWordStream({ density: Number(event.target.value) })}
            />
          </label>

          <label className="drawer-range">
            <span>
              Visibility <output>{Math.round(wordStream.opacity * 100)}%</output>
            </span>
            <input
              type="range"
              min="0.05"
              max="0.3"
              step="0.01"
              value={wordStream.opacity}
              onChange={(event) => updateWordStream({ opacity: Number(event.target.value) })}
            />
          </label>

          <label className="drawer-range">
            <span>
              Blur <output>{wordStream.blur}px</output>
            </span>
            <input
              type="range"
              min="0"
              max="4"
              step="0.5"
              value={wordStream.blur}
              onChange={(event) => updateWordStream({ blur: Number(event.target.value) })}
            />
          </label>
        </div>

        <p className="appearance-privacy-note">
          Words appear after their first use in your local outgoing messages. Names,
          links, phone numbers, email addresses, usernames and sensitive terms are
          filtered. Nothing is sent to the server.
        </p>
      </>
    )
  }

  function renderFolderTabs() {
    const folders = [
      ...systemFolders,
      ...customFolders.map((folder) => ({
        ...folder,
        custom: true,
      })),
    ]

    return (
      <div className="folder-tabs" aria-label="Chat folders">
        {folders.map((folder) => (
          <button
            key={folder.id}
            type="button"
            className={selectedFolderId === folder.id ? 'active' : ''}
            onClick={() => onSelectFolder(folder.id)}
            title={folder.title}
          >
            {folder.custom && <Folder size={14} />}
            <strong>{folder.title}</strong>
            <small>{folderCount(folder)}</small>
          </button>
        ))}
        <button
          type="button"
          className="folder-tabs-add"
          onClick={() => {
            setMenuView('folders')
            startCreateFolder()
            if (!menuOpen) onToggleMenu()
          }}
          title="Create folder"
        >
          <Plus size={16} />
        </button>
      </div>
    )
  }

  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <IconButton label="Menu" onClick={menuOpen ? closeMenu : openMainMenu} className={menuOpen ? 'is-active' : ''}>
          <Menu size={20} />
        </IconButton>
        <div className="brand">
          <div className="brand-mark">A</div>
          <strong>AstraChat</strong>
        </div>
        <IconButton
          label="New private chat"
          onClick={() => {
            setMenuView('contacts')
            if (!menuOpen) onToggleMenu()
          }}
        >
          <MessageCirclePlus size={20} />
        </IconButton>
      </header>

      {menuOpen && (
        <div className="menu-layer">
          <nav className="side-menu" aria-label="Main menu">
            {menuView === 'main' && renderMainMenu()}
            {menuView === 'profile' && renderProfileMenu()}
            {menuView === 'contacts' && renderContactsMenu()}
            {menuView === 'archive' && renderArchiveMenu()}
            {menuView === 'settings' && renderSettingsMenu()}
            {menuView === 'folders' && renderFoldersMenu()}
            {menuView === 'privacy' && renderPrivacyMenu()}
            {menuView === 'password' && renderPasswordMenu()}
            {menuView === 'sessions' && renderSessionsMenu()}
            {menuView === 'appearance' && renderAppearanceMenu()}
          </nav>
          <button className="menu-scrim" onClick={closeMenu} aria-label="Close menu" />
        </div>
      )}

      {renderFolderTabs()}

      <label className="search-field">
        <Search size={17} />
        <input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Search chats"
        />
      </label>

      <ChatList
        chats={visibleChats}
        selectedChatId={selectedChatId}
        folderTitle={selectedFolder?.title}
        canPinInFolder={Boolean(selectedCustomFolder)}
        onSelectChat={onSelectChat}
        onTogglePin={onTogglePin}
        onToggleMute={onToggleMute}
        onArchiveChat={onArchiveChat}
        onToggleFolderPin={(chatId) => onToggleFolderPin(selectedCustomFolder?.id, chatId)}
      />
    </aside>
  )
}
