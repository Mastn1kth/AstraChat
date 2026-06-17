import { useEffect, useRef, useState } from 'react'
import { useConfirm } from '../hooks/useConfirm'
import { t } from '../i18n'
import {
  Archive,
  ArrowLeft,
  Brush,
  Camera,
  Check,
  Copy,
  Database,
  Download,
  DownloadCloud,
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
  QrCode,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  Smartphone,
  Sun,
  LogOut,
  Trash2,
  Upload,
  UploadCloud,
  UserCircle,
  UserMinus,
  UserPlus,
  Users,
  X,
  XCircle,
  Waves,
} from 'lucide-react'
import Avatar from './Avatar'
import ChatList from './ChatList'
import IconButton from './IconButton'
import { formatChatTime } from '../utils/formatters'
import {
  getLocalStorageInfo,
  clearLocalStorageItem,
  getCacheStorageInfo,
  clearCache,
  clearAllCaches,
  formatBytes,
} from '../utils/storage'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function StorageMenu({ onBack, onResetState }) {
  const [localInfo, setLocalInfo] = useState(() =>
    typeof window === 'undefined' ? { keys: [], total: 0 } : getLocalStorageInfo(),
  )
  const [cacheInfo, setCacheInfo] = useState(null)
  const [clearing, setClearing] = useState(null)
  const [clearedMsg, setClearedMsg] = useState(null)

  useEffect(() => {
    getCacheStorageInfo().then(setCacheInfo)
  }, [])

  useEffect(() => {
    if (!clearedMsg) return undefined
    const id = setTimeout(() => setClearedMsg(null), 2000)
    return () => clearTimeout(id)
  }, [clearedMsg])

  async function handleClearLocal(key) {
    clearLocalStorageItem(key)
    setLocalInfo(getLocalStorageInfo())
    setClearedMsg(t('storage.localCleared'))
  }

  async function handleClearAllLocal() {
    const confirmed = window.confirm(`${t('menu.resetLocal')}?`)
    if (!confirmed) return
    onResetState()
    setLocalInfo(getLocalStorageInfo())
    setClearedMsg(t('storage.localCleared'))
  }

  async function handleClearCache(cacheKey) {
    setClearing(cacheKey)
    await clearCache(cacheKey)
    setClearing(null)
    setCacheInfo(await getCacheStorageInfo())
    setClearedMsg(t('storage.cacheCleared'))
  }

  async function handleClearAllCaches() {
    setClearing('all')
    await clearAllCaches()
    setClearing(null)
    setCacheInfo(await getCacheStorageInfo())
    setClearedMsg(t('storage.cacheCleared'))
  }

  const fmt = (bytes) => {
    const { n, unit } = formatBytes(bytes)
    return `${n} ${unit}`
  }

  return (
    <>
      <div className="drawer-menu-header">
        <button type="button" onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
        <strong>{t('storage.title')}</strong>
      </div>
      <div className="drawer-fields drawer-storage">
        {localInfo && (
          <section className="storage-section">
            <h4 className="storage-section-title">
              <Database size={16} /> {t('storage.localStorage')}
              <span className="storage-total">{fmt(localInfo.total)}</span>
            </h4>
            <div className="storage-items">
              {localInfo.keys.length === 0 && (
                <p className="drawer-empty">{t('storage.noData')}</p>
              )}
              {localInfo.keys.slice(0, 15).map((item) => (
                <div key={item.key} className="storage-item">
                  <span className="storage-item-key" title={item.key}>{item.key}</span>
                  <span className="storage-item-size">{fmt(item.size)}</span>
                  <button
                    className="storage-clear-btn"
                    onClick={() => handleClearLocal(item.key)}
                    disabled={clearing === item.key}
                    title={t('storage.clear')}
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <button
              className="storage-clear-all"
              onClick={handleClearAllLocal}
              disabled={clearing === 'local'}
            >
              <Trash2 size={14} /> {t('storage.clearAll')}
            </button>
          </section>
        )}

        {cacheInfo && (
          <section className="storage-section">
            <h4 className="storage-section-title">
              <Database size={16} /> {t('storage.cacheStorage')}
              <span className="storage-total">
                {fmt(cacheInfo.total)} ({cacheInfo.totalItems} {t('storage.items')})
              </span>
            </h4>
            <div className="storage-items">
              {cacheInfo.entries.filter((entry) => entry.items > 0).length === 0 && (
                <p className="drawer-empty">{t('storage.noData')}</p>
              )}
              {cacheInfo.entries.filter((entry) => entry.items > 0).map((entry) => (
                <div key={entry.cacheKey} className="storage-item">
                  <span className="storage-item-key">
                    {entry.cacheKey === 'astrachat-stickers-v1'
                      ? t('storage.cacheStickers')
                      : entry.cacheKey === 'astrachat-gifs-v1'
                        ? t('storage.cacheGifs')
                        : entry.cacheKey === 'astrachat-gif-categories-v1'
                          ? 'GIF categories'
                          : 'App cache'}
                  </span>
                  <span className="storage-item-size">{fmt(entry.size)} ({entry.items})</span>
                  <button
                    className="storage-clear-btn"
                    onClick={() => handleClearCache(entry.cacheKey)}
                    disabled={clearing === entry.cacheKey}
                    title={t('storage.clear')}
                  >
                    {clearing === entry.cacheKey ? <LoaderCircle size={14} className="spin" /> : <X size={14} />}
                  </button>
                </div>
              ))}
            </div>
            {cacheInfo.entries.some((entry) => entry.items > 0) && (
              <button
                className="storage-clear-all"
                onClick={handleClearAllCaches}
                disabled={clearing === 'all'}
              >
                <Trash2 size={14} /> {t('storage.clearAll')}
              </button>
            )}
          </section>
        )}

        {!localInfo && !cacheInfo && (
          <p className="drawer-empty">{t('storage.calculating')}</p>
        )}
      </div>
      {clearedMsg && <div className="toast storage-toast">{clearedMsg}</div>}
    </>
  )
}

function WallComposer({ onSend }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    const trimmed = text.trim()
    if (!trimmed || busy) return
    setBusy(true)
    const sent = await onSend(trimmed)
    setBusy(false)
    if (sent) setText('')
  }

  return (
    <form className="wall-composer" onSubmit={submit}>
      <input
        value={text}
        maxLength={120}
        placeholder={t('appearance.wallPlaceholder')}
        onChange={(event) => setText(event.target.value)}
      />
      <button type="submit" className="primary-button" disabled={busy || !text.trim()}>
        {busy ? '…' : t('appearance.wallSend')}
      </button>
    </form>
  )
}

export default function Sidebar({
  chats,
  chatFolders,
  selectedFolderId,
  contacts,
  user,
  settings,
  allMessages,
  selectedChatId,
  search,
  menuOpen,
  onSearch,
  onOpenGlobalSearch,
  onSelectChat,
  onSelectFolder,
  onOpenCreateSpace,
  onCreateChat,
  onUpdateSettings,
  onUpdateUser,
  onSendWallMessage,
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
  onCloudKeyBackup,
  onCloudKeyRestore,
  onUploadAvatar,
  onRemoveAvatar,
  onChangePassword,
  onDeleteAccount,
  onLoadSessions,
  onLoadTotpStatus,
  onStartTotpSetup,
  onVerifyTotpSetup,
  onDisableTotp,
  onLoadCloudPasswordStatus,
  onSetCloudPassword,
  onRemoveCloudPassword,
  onTerminateOtherSessions,
  onTerminateSession,
  onLoadSecurityAlerts,
  onMarkSecurityAlertRead,
  onMarkAllSecurityAlertsRead,
  onLoadBlockedContacts,
  onAddContact,
  onRemoveContact,
  onUnblockUser,
}) {
  const [menuView, setMenuView] = useState('main')
  const [encryptionInfo, setEncryptionInfo] = useState(null)
  const [contactSearch, setContactSearch] = useState('')
  const [sessions, setSessions] = useState([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [sessionsError, setSessionsError] = useState('')
  const [securityEvents, setSecurityEvents] = useState([])
  const [securityLoading, setSecurityLoading] = useState(false)
  const [securityError, setSecurityError] = useState('')
  const [blockedUsers, setBlockedUsers] = useState([])
  const [blockedLoading, setBlockedLoading] = useState(false)
  const [blockedError, setBlockedError] = useState('')
  const [passwordForm, setPasswordForm] = useState({ current: '', next: '', confirm: '' })
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [totpState, setTotpState] = useState({
    enabled: Boolean(user.totpEnabled),
    setup: null,
    qrDataUrl: '',
    code: '',
    disableCode: '',
    busy: false,
    error: '',
  })
  const [cloudPwState, setCloudPwState] = useState({ enabled: false, hint: null, busy: false, error: '' })
  const [cloudPwForm, setCloudPwForm] = useState({ password: '', hint: '', currentPassword: '', confirm: '' })
  const [inviteCopied, setInviteCopied] = useState(false)
  const [folderMode, setFolderMode] = useState('list')
  const [folderDraft, setFolderDraft] = useState({ id: '', title: '', chatIds: [] })
  const [folderBusy, setFolderBusy] = useState(false)
  const [folderError, setFolderError] = useState('')
  const keyImportRef = useRef(null)
  const avatarInputRef = useRef(null)
  const { confirm, dialog } = useConfirm()

  const WALLPAPERS = ['default', 'plain', 'lavender', 'mint', 'peach', 'night']
  const inviteUsername = String(user.username || '').replace(/^@/, '')
  const inviteLink = inviteUsername
    ? `${window.location.origin}/?add=${inviteUsername}`
    : ''

  useEffect(() => {
    setTotpState((current) => ({ ...current, enabled: Boolean(user.totpEnabled) }))
  }, [user.totpEnabled])

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

  async function confirmDeleteAccount() {
    const sure = await confirm(
      'Delete your account permanently? Your messages and the chats you created will be removed. This cannot be undone.',
    )
    if (sure) onDeleteAccount()
  }

  const privateContacts = contacts.filter(
    (contact) => contact.type === 'private' && contact.status !== 'saved',
  )
  const archivedChats = chats.filter((chat) => chat.archived)
  const normalizedContactSearch = contactSearch.trim().toLowerCase()
  const filteredContacts = privateContacts.filter((contact) => {
    if (!normalizedContactSearch) return Boolean(contact.isContact)
    return [contact.name, contact.username, contact.phone]
      .filter(Boolean)
      .some((value) => value.toLowerCase().includes(normalizedContactSearch))
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
    const direct = [chat.contact.name, chat.contact.username, chat.lastMessageText]
      .filter(Boolean)
      .some((value) => value.toLowerCase().includes(normalizedChatSearch))
    if (direct) return true
    // Full-history search runs locally over already-decrypted messages —
    // the server cannot search E2EE content, but this device can.
    return (allMessages?.[chat.id] || []).some(
      (message) =>
        !message.deleted &&
        typeof message.text === 'string' &&
        message.text.toLowerCase().includes(normalizedChatSearch),
    )
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
    const sure = await confirm(`Delete folder "${folder?.title || 'Folder'}"? Chats and messages will stay.`)
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

  async function refreshTotpStatus() {
    if (!onLoadTotpStatus) return
    setTotpState((current) => ({ ...current, busy: true, error: '' }))
    try {
      const status = await onLoadTotpStatus()
      setTotpState((current) => ({
        ...current,
        enabled: Boolean(status.enabled),
        busy: false,
      }))
    } catch (error) {
      setTotpState((current) => ({
        ...current,
        busy: false,
        error: error.message || 'Could not load two-factor status.',
      }))
    }
  }

  async function openTwoFactor() {
    setMenuView('twoFactor')
    await refreshTotpStatus()
    if (onLoadCloudPasswordStatus) {
      try {
        const status = await onLoadCloudPasswordStatus()
        setCloudPwState((current) => ({ ...current, enabled: status.enabled, hint: status.hint || null }))
      } catch { /* silent */ }
    }
  }

  async function submitCloudPassword(e) {
    e.preventDefault()
    if (cloudPwForm.password !== cloudPwForm.confirm) {
      setCloudPwState((current) => ({ ...current, error: 'Passwords do not match' }))
      return
    }
    setCloudPwState((current) => ({ ...current, busy: true, error: '' }))
    try {
      await onSetCloudPassword({
        password: cloudPwForm.password,
        hint: cloudPwForm.hint || undefined,
        currentPassword: cloudPwState.enabled ? cloudPwForm.currentPassword : undefined,
      })
      setCloudPwState({ enabled: true, hint: cloudPwForm.hint || null, busy: false, error: '' })
      setCloudPwForm({ password: '', hint: '', currentPassword: '', confirm: '' })
    } catch (error) {
      setCloudPwState((current) => ({ ...current, busy: false, error: error.message }))
    }
  }

  async function handleRemoveCloudPassword() {
    if (!cloudPwForm.currentPassword) {
      setCloudPwState((current) => ({ ...current, error: 'Enter your current cloud password first' }))
      return
    }
    setCloudPwState((current) => ({ ...current, busy: true, error: '' }))
    try {
      await onRemoveCloudPassword(cloudPwForm.currentPassword)
      setCloudPwState({ enabled: false, hint: null, busy: false, error: '' })
      setCloudPwForm({ password: '', hint: '', currentPassword: '', confirm: '' })
    } catch (error) {
      setCloudPwState((current) => ({ ...current, busy: false, error: error.message }))
    }
  }

  async function startTwoFactorSetup() {
    setTotpState((current) => ({ ...current, busy: true, error: '', setup: null, qrDataUrl: '', code: '' }))
    try {
      const setup = await onStartTotpSetup()
      const QRCode = await import('qrcode')
      const qrDataUrl = await QRCode.toDataURL(setup.otpauthUrl, {
        margin: 1,
        width: 220,
        color: { dark: '#1e1b4b', light: '#ffffff' },
      })
      setTotpState((current) => ({ ...current, setup, qrDataUrl, busy: false }))
    } catch (error) {
      setTotpState((current) => ({
        ...current,
        busy: false,
        error: error.message || 'Could not start two-factor setup.',
      }))
    }
  }

  async function submitTwoFactorSetup(event) {
    event.preventDefault()
    setTotpState((current) => ({ ...current, busy: true, error: '' }))
    try {
      await onVerifyTotpSetup(totpState.code)
      setTotpState((current) => ({
        ...current,
        enabled: true,
        setup: null,
        qrDataUrl: '',
        code: '',
        busy: false,
      }))
    } catch (error) {
      setTotpState((current) => ({
        ...current,
        busy: false,
        error: error.message || 'Could not verify the authentication code.',
      }))
    }
  }

  async function disableTwoFactor(event) {
    event.preventDefault()
    const sure = await confirm('Disable two-factor authentication for this account?')
    if (!sure) return
    setTotpState((current) => ({ ...current, busy: true, error: '' }))
    try {
      await onDisableTotp(totpState.disableCode)
      setTotpState((current) => ({
        ...current,
        enabled: false,
        disableCode: '',
        setup: null,
        qrDataUrl: '',
        busy: false,
      }))
    } catch (error) {
      setTotpState((current) => ({
        ...current,
        busy: false,
        error: error.message || 'Could not disable two-factor authentication.',
      }))
    }
  }

  async function refreshSecurityEvents() {
    setSecurityLoading(true)
    setSecurityError('')
    try {
      const events = await onLoadSecurityAlerts()
      setSecurityEvents(events)
    } catch (error) {
      setSecurityError(error.message || 'Could not load security alerts.')
    } finally {
      setSecurityLoading(false)
    }
  }

  async function openSecurityEvents() {
    setMenuView('security')
    await refreshSecurityEvents()
  }

  async function markSecurityEvent(eventId) {
    setSecurityLoading(true)
    setSecurityError('')
    try {
      await onMarkSecurityAlertRead(eventId)
      setSecurityEvents((events) =>
        events.map((event) =>
          event.id === eventId ? { ...event, readAt: event.readAt || new Date().toISOString() } : event,
        ),
      )
    } catch (error) {
      setSecurityError(error.message || 'Could not update security alert.')
    } finally {
      setSecurityLoading(false)
    }
  }

  async function markAllSecurityEvents() {
    setSecurityLoading(true)
    setSecurityError('')
    try {
      await onMarkAllSecurityAlertsRead()
      const now = new Date().toISOString()
      setSecurityEvents((events) => events.map((event) => ({ ...event, readAt: event.readAt || now })))
    } catch (error) {
      setSecurityError(error.message || 'Could not update security alerts.')
    } finally {
      setSecurityLoading(false)
    }
  }

  async function refreshBlockedUsers() {
    setBlockedLoading(true)
    setBlockedError('')
    try {
      const users = await onLoadBlockedContacts()
      setBlockedUsers(users)
    } catch (error) {
      setBlockedError(error.message || 'Could not load blocked users.')
    } finally {
      setBlockedLoading(false)
    }
  }

  async function openBlockedUsers() {
    setMenuView('blocked')
    await refreshBlockedUsers()
  }

  async function unblockFromList(userId) {
    setBlockedLoading(true)
    setBlockedError('')
    try {
      await onUnblockUser(userId)
      setBlockedUsers((users) => users.filter((user) => user.id !== userId))
    } catch (error) {
      setBlockedError(error.message || 'Could not unblock user.')
    } finally {
      setBlockedLoading(false)
    }
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

  function renderMenuHeader(title, backView = 'main') {

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
              {user.customStatus && <small className="menu-custom-status">{user.customStatus}</small>}
            </div>
          </button>
          <button onClick={closeMenu} aria-label="Close menu">
            <X size={19} />
          </button>
        </header>
        <div className="side-menu-actions">
          <button onClick={() => setMenuView('contacts')}>
            <MessageCirclePlus size={19} /> {t('menu.newPrivateChat')}
          </button>
          <button onClick={() => openCreateSpace('group')}>
            <Users size={19} /> {t('menu.newGroup')}
          </button>
          <button onClick={() => openCreateSpace('channel')}>
            <Hash size={19} /> {t('menu.newChannel')}
          </button>
          <button onClick={() => setMenuView('profile')}>
            <UserCircle size={19} /> {t('menu.myProfile')}
          </button>
          <button onClick={() => setMenuView('contacts')}>
            <Users size={19} /> {t('menu.contacts')}
          </button>
          <button onClick={() => setMenuView('archive')}>
            <Archive size={19} /> {t('menu.archivedChats')}
          </button>
          <button onClick={() => setMenuView('folders')}>
            <Folder size={19} /> {t('menu.folders')}
          </button>
          <button onClick={() => setMenuView('settings')}>
            <Settings size={19} /> {t('menu.settings')}
          </button>
        </div>
        <div className="side-menu-footer">
          <Sun size={15} /> {t('menu.themeHint')} <Moon size={15} />
        </div>
      </>
    )
  }

  function renderProfileMenu() {
    return (
      <>
        {renderMenuHeader(t('menu.myProfile'))}
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
          {user.customStatus && <p className="drawer-custom-status">{user.customStatus}</p>}
          <div className="drawer-avatar-actions">
            <button type="button" onClick={() => avatarInputRef.current?.click()}>
              <ImageUp size={15} /> {t('profile.uploadPhoto')}
            </button>
            <button type="button" className="ghost-danger" onClick={onRemoveAvatar}>
              <Trash2 size={15} /> {t('profile.removePhoto')}
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
          <label>
            <span>Status</span>
            <input
              value={user.customStatus || ''}
              maxLength={80}
              placeholder="emoji + text"
              onChange={(event) => onUpdateUser({ customStatus: event.target.value })}
            />
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
        {renderMenuHeader(t('menu.contacts'))}
        <label className="drawer-search">
          <Search size={17} />
          <input value={contactSearch} onChange={(event) => setContactSearch(event.target.value)} placeholder={t('search.people')} />
        </label>
        <div className="drawer-list">
          {filteredContacts.map((contact) => (
            <div key={contact.id} className="drawer-contact-row">
              <button className="drawer-contact" onClick={() => createPrivateChat(contact.id)}>
                <Avatar contact={contact} />
                <span>
                  <strong>{contact.name}</strong>
                  <small>{contact.isContact ? contact.lastSeen : 'Found user'}</small>
                </span>
              </button>
              {contact.isContact ? (
                <button
                  type="button"
                  className="drawer-contact-action"
                  title="Remove contact"
                  aria-label={`Remove ${contact.name} from contacts`}
                  onClick={() => onRemoveContact?.(contact.id)}
                >
                  <UserMinus size={16} />
                </button>
              ) : (
                <button
                  type="button"
                  className="drawer-contact-action"
                  title="Add contact"
                  aria-label={`Add ${contact.name} to contacts`}
                  onClick={() => onAddContact?.(contact.id)}
                >
                  <UserPlus size={16} />
                </button>
              )}
            </div>
          ))}
          {!filteredContacts.length && (
            <p className="drawer-empty">
              {normalizedContactSearch ? 'No users found.' : 'No saved contacts yet. Search people to add them.'}
            </p>
          )}
        </div>
      </>
    )
  }

  function renderArchiveMenu() {
    return (
      <>
        {renderMenuHeader(t('menu.archivedChats'))}
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
        {renderMenuHeader(t('menu.folders'))}
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
                    <span>{t(`folders.${folder.id}`)}</span>
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
                {!customFolders.length && <p className="drawer-empty">{t('folders.noCustom')}</p>}
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
        {renderMenuHeader(t('menu.settings'))}
        <div className="drawer-fields">
          <div className="drawer-setting-row">
            <span>{t('menu.theme')}</span>
            <div className="drawer-segmented">
              <button className={settings.theme === 'light' ? 'active' : ''} onClick={() => onUpdateSettings({ theme: 'light' })}>
                <Sun size={16} /> {t('menu.light')}
              </button>
              <button className={settings.theme === 'dark' ? 'active' : ''} onClick={() => onUpdateSettings({ theme: 'dark' })}>
                <Moon size={16} /> {t('menu.dark')}
              </button>
            </div>
          </div>
          <label className="drawer-toggle">
            <span>{t('menu.desktopNotifications')}</span>
            <input
              type="checkbox"
              checked={settings.notifications}
              onChange={(event) => onUpdateSettings({ notifications: event.target.checked })}
            />
          </label>
          <label className="drawer-toggle">
            <span>{t('menu.messageSound')}</span>
            <input
              type="checkbox"
              checked={settings.sound !== false}
              onChange={(event) => onUpdateSettings({ sound: event.target.checked })}
            />
          </label>
        </div>
        <div className="drawer-settings-list">
          <button onClick={() => setMenuView('privacy')}>
            <LockKeyhole size={18} /> {t('menu.privacy')}
          </button>
          <button onClick={openSessions}>
            <Smartphone size={18} /> {t('menu.devices')}
          </button>
          <button onClick={() => setMenuView('appearance')}>
            <Brush size={18} /> {t('menu.chatAppearance')}
          </button>
          <button onClick={() => setMenuView('folders')}>
            <Folder size={18} /> {t('menu.folders')}
          </button>
          <button onClick={() => setMenuView('storage')}>
            <RotateCcw size={18} /> {t('storage.title')}
          </button>
          <button className="danger-menu-action" onClick={onResetState}>
            <RotateCcw size={18} /> {t('menu.resetLocal')}
          </button>
          <button className="danger-menu-action" onClick={confirmDeleteAccount}>
            <Trash2 size={18} /> {t('menu.deleteAccount')}
          </button>
          <button className="danger-menu-action" onClick={onLogout}>
            <LogOut size={18} /> {t('menu.logout')}
          </button>
        </div>
      </>
    )
  }

  async function toggleEncryptionInfo() {
    if (encryptionInfo) {
      setEncryptionInfo(null)
      return
    }
    let fingerprint = ''
    try {
      const keyText = JSON.stringify(user.encryptionPublicKey || '')
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(keyText))
      fingerprint = [...new Uint8Array(digest)]
        .slice(0, 8)
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join(' ')
        .toUpperCase()
    } catch {
      // Fingerprint is informational; show the card without it.
    }
    setEncryptionInfo({ fingerprint })
  }

  function renderPrivacyMenu() {
    return (
      <>
        {renderMenuHeader(t('menu.privacy'), 'settings')}
        <div className="drawer-settings-list">
          <button onClick={onExportEncryptionKey}>
            <Download size={18} /> {t('privacy.exportKey')}
          </button>
          <button onClick={() => keyImportRef.current?.click()}>
            <Upload size={18} /> {t('privacy.importKey')}
          </button>
          <button
            onClick={() => {
              const passphrase = window.prompt(t('cloudKey.askPassphrase'))
              if (!passphrase) return
              if (passphrase.length < 8) {
                onUpdateSettings({ toast: t('cloudKey.tooShort') })
                return
              }
              const confirmPhrase = window.prompt(t('cloudKey.repeatPassphrase'))
              if (confirmPhrase !== passphrase) {
                onUpdateSettings({ toast: t('cloudKey.mismatch') })
                return
              }
              onCloudKeyBackup?.(passphrase)
            }}
          >
            <UploadCloud size={18} /> {t('cloudKey.save')}
          </button>
          <button
            onClick={() => {
              const passphrase = window.prompt(t('cloudKey.askPassphrase'))
              if (passphrase) onCloudKeyRestore?.(passphrase)
            }}
          >
            <DownloadCloud size={18} /> {t('cloudKey.restore')}
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
          <button onClick={toggleEncryptionInfo}>
            <KeyRound size={18} /> {t('privacy.encryptionStatus')}
          </button>
          {encryptionInfo && (
            <div className="encryption-status-card">
              <p>
                <strong>{user.encryptionPublicKey ? t('privacy.encryptionActive') : t('privacy.encryptionMissing')}</strong>
              </p>
              {user.encryptionPublicKey ? (
                <>
                  <p className="encryption-fingerprint">
                    {t('privacy.fingerprint')} <code>{encryptionInfo.fingerprint || '…'}</code>
                  </p>
                  <p>{t('privacy.encryptionHint')}</p>
                </>
              ) : (
                <p>{t('privacy.encryptionRelogin')}</p>
              )}
            </div>
          )}
          <button onClick={() => setMenuView('password')}>
            <KeyRound size={18} /> {t('privacy.changePassword')}
          </button>
          <button onClick={openTwoFactor}>
            <ShieldCheck size={18} /> {t('privacy.twoFactor')}
          </button>
          <button onClick={openSessions}>
            <Smartphone size={18} /> {t('privacy.sessions')}
          </button>
          <button onClick={openSecurityEvents}>
            <LockKeyhole size={18} /> {t('privacy.securityAlerts')}
          </button>
          <button onClick={openBlockedUsers}>
            <XCircle size={18} /> {t('privacy.blockedUsers')}
          </button>
        </div>
        <p className="appearance-privacy-note">
          Keep this key private. It restores access to encrypted messages and media
          for this account on another browser.
        </p>
      </>
    )
  }

  function renderTwoFactorMenu() {
    return (
      <>
        {renderMenuHeader(t('privacy.twoFactor'), 'privacy')}
        <section className="drawer-fields totp-panel">
          <div className={`totp-status ${totpState.enabled ? 'enabled' : ''}`}>
            <ShieldCheck size={18} />
            <span>{totpState.enabled ? 'Enabled' : 'Not enabled'}</span>
          </div>

          {!totpState.enabled && !totpState.setup && (
            <button className="primary-button drawer-password-submit" type="button" onClick={startTwoFactorSetup} disabled={totpState.busy}>
              {totpState.busy ? 'Preparing...' : 'Set up authenticator app'}
            </button>
          )}

          {!totpState.enabled && totpState.setup && (
            <form className="totp-setup-form" onSubmit={submitTwoFactorSetup}>
              {totpState.qrDataUrl ? (
                <img className="totp-qr" src={totpState.qrDataUrl} alt="Authenticator app QR code" />
              ) : (
                <div className="totp-qr-placeholder"><QrCode size={38} /></div>
              )}
              <label>
                <span>Manual setup key</span>
                <input readOnly value={totpState.setup.secret} onFocus={(event) => event.target.select()} />
              </label>
              <label>
                <span>6-digit code</span>
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={totpState.code}
                  onChange={(event) => setTotpState((current) => ({
                    ...current,
                    code: event.target.value.replace(/\D/g, '').slice(0, 6),
                  }))}
                  required
                />
              </label>
              <button className="primary-button drawer-password-submit" type="submit" disabled={totpState.busy || totpState.code.length !== 6}>
                {totpState.busy ? 'Verifying...' : 'Enable two-factor'}
              </button>
            </form>
          )}

          {totpState.enabled && (
            <form className="totp-setup-form" onSubmit={disableTwoFactor}>
              <label>
                <span>Authenticator code</span>
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={totpState.disableCode}
                  onChange={(event) => setTotpState((current) => ({
                    ...current,
                    disableCode: event.target.value.replace(/\D/g, '').slice(0, 6),
                  }))}
                  required
                />
              </label>
              <button className="primary-button danger drawer-password-submit" type="submit" disabled={totpState.busy || totpState.disableCode.length !== 6}>
                {totpState.busy ? 'Disabling...' : 'Disable two-factor'}
              </button>
            </form>
          )}

          {totpState.error && <p className="drawer-empty session-error">{totpState.error}</p>}
        </section>
        <p className="appearance-privacy-note">
          Sign-in will require both your password and a current code from your authenticator app.
        </p>

        <div className="drawer-section-title">Two-step verification (cloud password)</div>
        <section className="drawer-fields totp-panel">
          <div className={`totp-status ${cloudPwState.enabled ? 'enabled' : ''}`}>
            <LockKeyhole size={18} />
            <span>{cloudPwState.enabled ? `Enabled${cloudPwState.hint ? ` · Hint: ${cloudPwState.hint}` : ''}` : 'Not enabled'}</span>
          </div>
          <form className="totp-setup-form" onSubmit={submitCloudPassword}>
            {cloudPwState.enabled && (
              <label>
                <span>Current cloud password</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  value={cloudPwForm.currentPassword}
                  onChange={(e) => setCloudPwForm((current) => ({ ...current, currentPassword: e.target.value }))}
                />
              </label>
            )}
            <label>
              <span>{cloudPwState.enabled ? 'New password' : 'Password'} (min 6 chars)</span>
              <input
                type="password"
                autoComplete="new-password"
                minLength={6}
                value={cloudPwForm.password}
                onChange={(e) => setCloudPwForm((current) => ({ ...current, password: e.target.value }))}
              />
            </label>
            <label>
              <span>Confirm password</span>
              <input
                type="password"
                autoComplete="new-password"
                value={cloudPwForm.confirm}
                onChange={(e) => setCloudPwForm((current) => ({ ...current, confirm: e.target.value }))}
              />
            </label>
            <label>
              <span>Hint (optional)</span>
              <input
                type="text"
                maxLength={255}
                value={cloudPwForm.hint}
                onChange={(e) => setCloudPwForm((current) => ({ ...current, hint: e.target.value }))}
              />
            </label>
            <button
              className="primary-button drawer-password-submit"
              type="submit"
              disabled={cloudPwState.busy || cloudPwForm.password.length < 6 || cloudPwForm.password !== cloudPwForm.confirm}
            >
              {cloudPwState.busy ? 'Saving...' : cloudPwState.enabled ? 'Change cloud password' : 'Set cloud password'}
            </button>
          </form>
          {cloudPwState.enabled && (
            <button
              className="primary-button danger drawer-password-submit"
              type="button"
              disabled={cloudPwState.busy || !cloudPwForm.currentPassword}
              onClick={handleRemoveCloudPassword}
            >
              Remove cloud password
            </button>
          )}
          {cloudPwState.error && <p className="drawer-empty session-error">{cloudPwState.error}</p>}
        </section>
        <p className="appearance-privacy-note">
          When enabled, signing in from a new device requires both your password and this cloud password.
        </p>
      </>
    )
  }

  function renderSecurityMenu() {
    return (
      <>
        {renderMenuHeader(t('privacy.securityAlerts'), 'privacy')}
        <div className="drawer-settings-list session-actions">
          <button onClick={refreshSecurityEvents} disabled={securityLoading}>
            {securityLoading ? <LoaderCircle className="send-spinner" size={18} /> : <LockKeyhole size={18} />}
            Refresh alerts
          </button>
          <button onClick={markAllSecurityEvents} disabled={securityLoading || !securityEvents.some((event) => !event.readAt)}>
            <Check size={18} /> {t('privacy.markAllRead')}
          </button>
        </div>
        {securityError && <p className="drawer-empty session-error">{securityError}</p>}
        <div className="drawer-list session-list">
          {securityEvents.map((event) => (
            <article key={event.id} className={`session-card ${event.readAt ? '' : 'security-unread'}`}>
              <div>
                <strong>{event.title}</strong>
                <small>{event.body || event.type}</small>
                <small>{new Date(event.createdAt).toLocaleString()}</small>
              </div>
              {!event.readAt && (
                <button onClick={() => markSecurityEvent(event.id)} disabled={securityLoading}>
                  Read
                </button>
              )}
            </article>
          ))}
          {!securityLoading && !securityEvents.length && <p className="drawer-empty">No security alerts.</p>}
        </div>
      </>
    )
  }

  function renderBlockedMenu() {
    return (
      <>
        {renderMenuHeader(t('privacy.blockedUsers'), 'privacy')}
        <div className="drawer-settings-list session-actions">
          <button onClick={refreshBlockedUsers} disabled={blockedLoading}>
            {blockedLoading ? <LoaderCircle className="send-spinner" size={18} /> : <XCircle size={18} />}
            Refresh blocked users
          </button>
        </div>
        {blockedError && <p className="drawer-empty session-error">{blockedError}</p>}
        <div className="drawer-list session-list">
          {blockedUsers.map((blocked) => (
            <article key={blocked.id} className="session-card">
              <div>
                <strong>{blocked.name}</strong>
                <small>@{blocked.username}</small>
                <small>{blocked.blockedAt ? `Blocked ${new Date(blocked.blockedAt).toLocaleString()}` : 'Blocked'}</small>
              </div>
              <button onClick={() => unblockFromList(blocked.id)} disabled={blockedLoading}>
                Unblock
              </button>
            </article>
          ))}
          {!blockedLoading && !blockedUsers.length && <p className="drawer-empty">No blocked users.</p>}
        </div>
      </>
    )
  }

  function renderSessionsMenu() {
    return (
      <>
        {renderMenuHeader(t('privacy.sessions'), 'settings')}
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
        {renderMenuHeader(t('privacy.changePassword'), 'privacy')}
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
    const liveWall = settings.liveWall || { enabled: false, opacity: 0.5, speed: 1 }

    function updateWordStream(patch) {
      onUpdateSettings({
        wordStream: {
          ...wordStream,
          ...patch,
        },
      })
    }

    function updateLiveWall(patch) {
      onUpdateSettings({
        liveWall: {
          ...liveWall,
          ...patch,
        },
      })
    }

    return (
      <>
        {renderMenuHeader(t('menu.chatAppearance'), 'settings')}
        <div className="drawer-fields appearance-settings live-wall-settings">
          <label className="drawer-toggle appearance-master-toggle">
            <span>{t('appearance.liveWall')}</span>
            <input
              type="checkbox"
              checked={liveWall.enabled}
              onChange={(event) => updateLiveWall({ enabled: event.target.checked })}
            />
          </label>

          {liveWall.enabled && (
            <>
              <label className="drawer-range">
                <span>
                  {t('appearance.brightness')} <output>{Math.round(liveWall.opacity * 100)}%</output>
                </span>
                <input
                  type="range"
                  min="0.15"
                  max="1"
                  step="0.05"
                  value={liveWall.opacity}
                  onChange={(event) => updateLiveWall({ opacity: Number(event.target.value) })}
                />
              </label>
              <label className="drawer-range">
                <span>
                  {t('appearance.speed')} <output>{liveWall.speed.toFixed(2)}x</output>
                </span>
                <input
                  type="range"
                  min="0.5"
                  max="2.5"
                  step="0.25"
                  value={liveWall.speed}
                  onChange={(event) => updateLiveWall({ speed: Number(event.target.value) })}
                />
              </label>
              {onSendWallMessage && <WallComposer onSend={onSendWallMessage} />}
            </>
          )}
        </div>
        <p className="appearance-privacy-note">
          {t('appearance.wallNote')}
        </p>
        <div className="drawer-fields appearance-settings">
          <div className="drawer-setting-row drawer-wallpaper">
            <span>{t('appearance.wallpaper')}</span>
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
            <span>{t('appearance.wordStream')}</span>
            <input
              type="checkbox"
              checked={wordStream.enabled}
              onChange={(event) => updateWordStream({ enabled: event.target.checked })}
            />
          </label>

          <label className="drawer-range">
            <span>
              {t('appearance.speed')} <output>{wordStream.speed.toFixed(2)}x</output>
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
              {t('appearance.lines')} <output>{wordStream.density}</output>
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
              {t('appearance.visibility')} <output>{Math.round(wordStream.opacity * 100)}%</output>
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
              {t('appearance.blur')} <output>{wordStream.blur}px</output>
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
          {t('appearance.wordNote')}
        </p>
      </>
    )
  }

  function renderFolderTabs() {
    const folders = [
      ...systemFolders.map((folder) => ({
        ...folder,
        title: t(`folders.${folder.id}`),
      })),
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
    <>
    <aside className="sidebar">
      <header className="sidebar-header">
        <div className="brand">
          <div className="brand-mark"><Waves size={18} /></div>
          <div className="brand-text">
            <strong>Onda</strong>
            <span className="brand-subtitle">спокойный мессенджер</span>
          </div>
        </div>
        <IconButton
          label="New private chat"
          onClick={() => {
            setMenuView('contacts')
            if (!menuOpen) onToggleMenu()
          }}
        >
          <Pencil size={18} />
        </IconButton>
        <IconButton label="Menu" onClick={menuOpen ? closeMenu : openMainMenu} className={menuOpen ? 'is-active' : ''}>
          <Menu size={20} />
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
            {menuView === 'twoFactor' && renderTwoFactorMenu()}
            {menuView === 'sessions' && renderSessionsMenu()}
            {menuView === 'security' && renderSecurityMenu()}
            {menuView === 'blocked' && renderBlockedMenu()}
            {menuView === 'appearance' && renderAppearanceMenu()}
            {menuView === 'storage' && (
              <StorageMenu onBack={() => setMenuView('settings')} onResetState={onResetState} />
            )}
          </nav>
          <button className="menu-scrim" onClick={closeMenu} aria-label="Close menu" />
        </div>
      )}

      {renderFolderTabs()}

      <div className="search-row">
        <label className="search-field">
          <Search size={17} />
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder={t('search.chats')}
          />
        </label>
        <button
          className="global-search-btn"
          onClick={onOpenGlobalSearch}
          title="Global search (Ctrl+K)"
          aria-label="Global search"
        >
          <Search size={16} />
          <kbd>K</kbd>
        </button>
      </div>

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
    {dialog}
    </>
  )
}
