import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { setLang, t } from './i18n'
import { useConfirm } from './hooks/useConfirm'
import AuthScreen from './components/AuthScreen'
import PermissionOnboarding from './components/PermissionOnboarding'
import useWebRTCCall from './hooks/useWebRTCCall'
import { contacts as seedContacts, currentUser, initialChats, initialMessages } from './data/sampleData'
import { byPinnedThenRecent, getLastMessage } from './utils/formatters'
import { loadMessengerState, resetMessengerState, saveMessengerState } from './utils/storage'
import { upsertAccount } from './utils/accounts'
import { setCustomEmojiMap } from './utils/customEmojiStore'
import { bumpAvatarCache } from './utils/avatarCache'
import {
  changePassword,
  blockUser,
  createChatFolder,
  createChat as createServerChat,
  deleteAccount,
  deleteAvatar,
  deleteChatFolder,
  deleteChatMessage,
  deleteChatMessageForMe,
  disableTotp,
  editChatMessage,
  getCallHistory,
  getChatFolders,
  getChatMessageContext,
  getSessions,
  getChatMessages,
  getChatMembers,
  addChatMember,
  addContact,
  removeChatMember,
  removeContact,
  updateChatInfo,
  getContacts,
  getChats,
  pinChatMessage,
  getBlockedUsers,
  getCurrentSession,
  getSecurityEvents,
  getCloudPasswordStatus,
  getTotpStatus,
  loginAccount,
  logoutAccount,
  markAllSecurityEventsRead,
  markSecurityEventRead,
  registerAccount,
  reportAbuse,
  searchUsers,
  sendChatMessage,
  startTotpSetup,
  terminateOtherSessions,
  terminateSession,
  updateChatFolder,
  updateChatFolderChat,
  updateChatMemberPermissions,
  updateChatMemberRole,
  toggleMessageReaction,
  votePoll,
  markMessagesRead,
  updateChatSettings,
  updateProfile,
  updateEncryptionPublicKey,
  unblockUser,
  uploadAvatar,
  uploadMedia,
  verifyTotpSetup,
  setCloudPassword,
  removeCloudPassword,
  startPhoneAuth,
  verifyPhoneAuth,
  getInstalledCustomEmojiPacks,
} from './api/client'
import {
  decryptBlobForUser,
  decryptKeyBackupWithPassphrase,
  decryptTextForUser,
  encryptBlobForRecipients,
  encryptKeyBackupWithPassphrase,
  encryptTextForRecipients,
  ensureUserKeyPair,
  exportUserKeyBackup,
  importUserKeyBackup,
  publicKeyEquals,
} from './utils/clientEncryption'
import {
  DEFAULT_WORD_STREAM_SETTINGS,
  extractPrivateWordStream,
} from './utils/wordStream'
import { DEFAULT_LIVE_WALL_SETTINGS, extractAllChatWords } from './utils/liveWall'
import { GlobalAudioContext, useGlobalAudioProvider } from './hooks/useGlobalAudio'
import {
  API_BASE,
  confirmQrLogin,
  getCloudKeyBackup,
  getPrivacySettings,
  getWallMessages,
  putCloudKeyBackup,
  sendWallMessage,
  updatePrivacySettings,
} from './api/client'
import { ensureNotificationPermission, playIncomingSound, showDesktopNotification } from './utils/notify'
import { hasCompletedPermissionOnboarding } from './utils/permissions'
import {
  decodeRichMessage,
  encodeRichMessage,
  getMessagePlainText,
  getRichSearchText,
} from './utils/richMessages'

const APP_TITLE = 'Onda'
const AppShell = lazy(() => import('./components/AppShell'))

async function enableWebPushNotifications() {
  const push = await import('./utils/push')
  return push.enableWebPushNotifications()
}

async function disableWebPushNotifications() {
  const push = await import('./utils/push')
  return push.disableWebPushNotifications()
}

async function requestFcmTokenForAuth() {
  const push = await import('./utils/push')
  return push.requestFcmTokenForAuth()
}

const SYSTEM_CHAT_FOLDERS = [
  { id: 'all', title: 'All', filter: 'all' },
  { id: 'unread', title: 'Unread', filter: 'unread' },
  { id: 'personal', title: 'Personal', filter: 'private' },
  { id: 'groups', title: 'Groups', filter: 'group' },
  { id: 'channels', title: 'Channels', filter: 'channel' },
  { id: 'archived', title: 'Archived', filter: 'archived' },
]

const EMPTY_CHAT_FOLDERS = {
  systemFolders: SYSTEM_CHAT_FOLDERS,
  folders: [],
}

const fallbackState = {
  user: currentUser,
  contacts: seedContacts,
  chats: initialChats,
  messages: initialMessages,
  settings: {
    theme: 'light',
    language: 'ru',
    notifications: true,
    sound: true,
    chatBackground: 'default',
    wordStream: DEFAULT_WORD_STREAM_SETTINGS,
    liveWall: DEFAULT_LIVE_WALL_SETTINGS,
  },
  chatFolders: EMPTY_CHAT_FOLDERS,
}

function notificationBody(message) {
  if (message.deleted) return 'Message deleted'
  if (message.text) return message.text
  if (message.media) {
    const labels = {
      image: '\u{1F4F7} Photo',
      video: '\u{1F4F9} Video',
      voice: '\u{1F3A4} Voice message',
      audio: '\u{1F3B5} Audio',
      file: '\u{1F4CE} File',
    }
    return labels[message.media.kind] || 'Attachment'
  }
  return 'New message'
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function messageMentionsCurrentUser(text, user) {
  const username = String(user?.username || '').replace(/^@/, '').trim()
  if (!username) return false
  return new RegExp(`(^|[^\\w])@${escapeRegExp(username)}(?=$|[^\\w])`, 'i').test(
    String(text || ''),
  )
}

function shouldNotifyForChat(chat, mentioned) {
  const pushMode = chat?.pushMode || 'default'
  if (pushMode === 'off') return false
  if (mentioned) return true
  if (chat?.muted) return false
  if (pushMode === 'mentions') return false
  return true
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function extractInviteUsernameFromLocation() {
  if (typeof window === 'undefined') return ''
  const params = new URLSearchParams(window.location.search)
  const add = params.get('add')
  const pathMatch = /^\/u\/([^/?#]+)/i.exec(window.location.pathname)
  const username = (add || pathMatch?.[1] || '').replace(/^@/, '').toLowerCase()
  if (add || pathMatch) {
    if (add) params.delete('add')
    const query = params.toString()
    window.history.replaceState({}, '', `/${query ? `?${query}` : ''}`)
  }
  return username
}

function normalizeChatFolders(payload = EMPTY_CHAT_FOLDERS) {
  return {
    systemFolders: payload.systemFolders?.length ? payload.systemFolders : SYSTEM_CHAT_FOLDERS,
    folders: (payload.folders || []).map((folder) => ({
      id: folder.id,
      title: folder.title,
      icon: folder.icon || '',
      sortOrder: folder.sortOrder || 0,
      createdAt: folder.createdAt || new Date().toISOString(),
      updatedAt: folder.updatedAt || folder.createdAt || new Date().toISOString(),
      chats: (folder.chats || []).map((chat) => ({
        chatId: chat.chatId,
        pinned: Boolean(chat.pinned),
        pinnedAt: chat.pinnedAt || null,
        addedAt: chat.addedAt || new Date().toISOString(),
      })),
    })),
  }
}

async function normalizeServerMessage(message, currentUserId) {
  if (message.isSystem) {
    return {
      id: message.id,
      senderId: message.senderId,
      isSystem: true,
      systemType: message.systemType,
      systemData: message.systemData,
      time: message.sentAt || message.createdAt,
      text: '',
      backend: true,
    }
  }
  const decrypted = await decryptTextForUser(message.text || '', currentUserId)
  const decoded = decodeRichMessage(decrypted.text)
  const media = await normalizeServerMedia(message.media, currentUserId)
  return {
    id: message.id,
    senderId: message.senderId,
    text: decoded.text,
    rich: decoded.rich,
    albumId: decoded.rich?.type === 'album' ? decoded.rich.albumId : undefined,
    albumIndex: decoded.rich?.type === 'album' ? decoded.rich.index : undefined,
    albumCount: decoded.rich?.type === 'album' ? decoded.rich.count : undefined,
    time: message.createdAt,
    edited: Boolean(message.editedAt),
    deleted: Boolean(message.deletedAt),
    status: message.status || 'sent',
    replyToId: message.replyToId || undefined,
    forwarded: Boolean(message.forwarded),
    forwardedFromMessageId: message.forwardedFromMessageId || undefined,
    forwardedFromChatId: message.forwardedFromChatId || undefined,
    reactions: message.reactions || {},
    topicId: message.topicId || null,
    media,
    readBy: message.readBy || [],
    disappearsAt: message.disappearsAt || null,
    importedFromName: message.importedFromName || null,
    backend: true,
    encrypted: decrypted.encrypted,
    decryptFailed: decrypted.failed,
  }
}

async function normalizeServerMedia(media, currentUserId) {
  if (!media || !media.encrypted) return media || null

  try {
    const sourceUrl = media.cdnUrl || media.url
    const response = await fetch(sourceUrl, { credentials: media.cdnUrl ? 'omit' : 'same-origin' })
    if (!response.ok) throw new Error('Media download failed')
    const decrypted = await decryptBlobForUser(await response.blob(), media.envelope, currentUserId, media.mimeType)
    if (decrypted.failed || !decrypted.blob) throw new Error('Media decrypt failed')
    return {
      ...media,
      url: URL.createObjectURL(decrypted.blob),
      size: decrypted.blob.size,
      decrypted: true,
    }
  } catch {
    return {
      ...media,
      url: '',
      decrypted: false,
      decryptFailed: true,
    }
  }
}

function mergeMessagesById(existingMessages = [], nextMessages = []) {
  const byId = new Map()
  existingMessages.forEach((message) => byId.set(message.id, message))
  nextMessages.forEach((message) => byId.set(message.id, message))
  return Array.from(byId.values()).sort((a, b) => new Date(a.time) - new Date(b.time))
}

function formatLastSeen(lastSeenAt) {
  if (!lastSeenAt) return t('status.lastSeenRecently')
  const date = new Date(lastSeenAt)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return t('status.lastSeenAt', { time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })
  }
  return t('status.lastSeenDate', { date: date.toLocaleDateString([], { day: 'numeric', month: 'short' }) })
}

function getInitials(name) {
  return String(name || 'Chat')
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function blobToCanvasBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality)
  })
}

function waitForMediaEvent(target, eventName, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup()
      reject(new Error(`${eventName} timed out`))
    }, timeoutMs)
    function cleanup() {
      window.clearTimeout(timeout)
      target.removeEventListener(eventName, handleSuccess)
      target.removeEventListener('error', handleError)
    }
    function handleSuccess() {
      cleanup()
      resolve()
    }
    function handleError() {
      cleanup()
      reject(new Error(`${eventName} failed`))
    }
    target.addEventListener(eventName, handleSuccess, { once: true })
    target.addEventListener('error', handleError, { once: true })
  })
}

function getSupportedVideoMimeType() {
  if (!window.MediaRecorder) return ''
  return [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ].find((type) => window.MediaRecorder.isTypeSupported(type)) || ''
}

function captureVideoElementStream(video) {
  return video.captureStream?.() || video.mozCaptureStream?.() || null
}

async function compressVideoInBrowser(file) {
  const mimeType = getSupportedVideoMimeType()
  const probeCanvas = document.createElement('canvas')
  if (!mimeType || !probeCanvas.captureStream) {
    throw new Error('Browser video compression is unavailable')
  }

  const sourceUrl = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.src = sourceUrl
  video.muted = true
  video.playsInline = true
  video.preload = 'metadata'

  try {
    await waitForMediaEvent(video, 'loadedmetadata')
    if (!Number.isFinite(video.duration) || video.duration <= 0 || video.duration > 45) {
      throw new Error('Video is too long for browser compression')
    }

    const maxWidth = 960
    const scale = Math.min(1, maxWidth / video.videoWidth)
    const width = Math.max(2, Math.round(video.videoWidth * scale))
    const height = Math.max(2, Math.round(video.videoHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    const canvasStream = canvas.captureStream(24)
    const sourceStream = captureVideoElementStream(video)
    const mixedStream = new MediaStream([
      ...canvasStream.getVideoTracks(),
      ...(sourceStream?.getAudioTracks() || []),
    ])
    const chunks = []
    const recorder = new MediaRecorder(mixedStream, {
      mimeType,
      videoBitsPerSecond: 1_200_000,
      audioBitsPerSecond: 96_000,
    })

    const done = new Promise((resolve, reject) => {
      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      })
      recorder.addEventListener('stop', resolve, { once: true })
      recorder.addEventListener('error', () => reject(new Error('Video compression failed')), {
        once: true,
      })
    })

    let drawing = true
    function drawFrame() {
      if (!drawing) return
      context.drawImage(video, 0, 0, width, height)
      window.requestAnimationFrame(drawFrame)
    }

    recorder.start(1000)
    await video.play()
    drawFrame()
    await waitForMediaEvent(video, 'ended', Math.ceil(video.duration * 1000) + 5000)
    drawing = false
    if (recorder.state !== 'inactive') recorder.stop()
    await done
    mixedStream.getTracks().forEach((track) => track.stop())
    sourceStream?.getTracks().forEach((track) => track.stop())

    const compressed = new Blob(chunks, { type: mimeType.split(';')[0] })
    if (!compressed.size || compressed.size >= file.size * 0.95) {
      throw new Error('Video compression did not reduce file size')
    }
    return {
      blob: compressed,
      kind: 'video',
      mimeType: compressed.type || 'video/webm',
      width,
      height,
      originalSize: file.size,
      compressed: true,
    }
  } finally {
    video.pause()
    URL.revokeObjectURL(sourceUrl)
  }
}

async function getAudioDurationMs(file) {
  const url = URL.createObjectURL(file)
  const audio = document.createElement('audio')
  audio.preload = 'metadata'
  audio.src = url
  try {
    await waitForMediaEvent(audio, 'loadedmetadata', 6000)
    const seconds = Number.isFinite(audio.duration) ? audio.duration : 0
    return Math.max(0, Math.round(seconds * 1000))
  } catch {
    return 0
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function getVideoDurationMs(file) {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.preload = 'metadata'
  video.src = url
  try {
    await waitForMediaEvent(video, 'loadedmetadata', 6000)
    const seconds = Number.isFinite(video.duration) ? video.duration : 0
    return Math.max(0, Math.round(seconds * 1000))
  } catch {
    return 0
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function prepareClientMediaFile(file) {
  if (file.type.startsWith('audio/')) {
    const isVoiceRecording = /^voice-\d+\.(webm|ogg|m4a)$/i.test(file.name)
    return {
      blob: file,
      kind: isVoiceRecording ? 'voice' : 'audio',
      mimeType: file.type || 'audio/webm',
      width: null,
      height: null,
      durationMs: await getAudioDurationMs(file),
      originalSize: file.size,
      compressed: false,
    }
  }

  if (file.type.startsWith('video/')) {
    const isVideoNote = /^video-note-\d+\.(webm|mp4)$/i.test(file.name)
    if (isVideoNote) {
      return {
        blob: file,
        kind: 'video_note',
        mimeType: file.type || 'video/webm',
        width: null,
        height: null,
        durationMs: await getVideoDurationMs(file),
        originalSize: file.size,
        compressed: false,
      }
    }
    try {
      return await compressVideoInBrowser(file)
    } catch {
      // Keep client-side media encryption even when browser-side video compression is unavailable.
    }
    return {
      blob: file,
      kind: 'video',
      mimeType: file.type || 'video/mp4',
      width: null,
      height: null,
      originalSize: file.size,
      compressed: false,
    }
  }

  if (!file.type.startsWith('image/')) {
    return {
      blob: file,
      kind: 'file',
      mimeType: file.type || 'application/octet-stream',
      width: null,
      height: null,
      originalSize: file.size,
      compressed: false,
    }
  }

  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 1920 / bitmap.width, 1920 / bitmap.height)
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    context.drawImage(bitmap, 0, 0, width, height)
    bitmap.close?.()
    const compressed = await blobToCanvasBlob(canvas, 'image/webp', 0.8)
    if (!compressed) throw new Error('Image compression failed')
    return {
      blob: compressed,
      kind: 'image',
      mimeType: 'image/webp',
      width,
      height,
      originalSize: file.size,
      compressed: compressed.size < file.size,
    }
  } catch {
    return {
      blob: file,
      kind: 'image',
      mimeType: file.type || 'image/jpeg',
      width: null,
      height: null,
      originalSize: file.size,
      compressed: false,
    }
  }
}

function AppInner() {
  const [state, setState] = useState(() => loadMessengerState(fallbackState))
  const [auth, setAuth] = useState({
    status: 'loading',
    user: null,
    error: '',
  })
  const [prefillLogin, setPrefillLogin] = useState(null)
  const [selectedChatId, setSelectedChatId] = useState(() => state.chats.find((chat) => !chat.archived)?.id || '')
  const [selectedFolderId, setSelectedFolderId] = useState('all')
  const [hasMoreMessages, setHasMoreMessages] = useState({})
  const [unreadFromId, setUnreadFromId] = useState({}) // chatId → first unread message id
  const [selectedMessageIds, setSelectedMessageIds] = useState(new Set())
  const [sidebarSearch, setSidebarSearch] = useState('')
  const [messageSearch, setMessageSearch] = useState('')
  const [replyToId, setReplyToId] = useState('')
  const [editingMessageId, setEditingMessageId] = useState('')
  const [forwardSource, setForwardSource] = useState(null)
  const [selectedMessageId, setSelectedMessageId] = useState('')
  const [toast, setToast] = useState('')
  const [permissionPromptOpen, setPermissionPromptOpen] = useState(false)
  const [pendingInvite, setPendingInvite] = useState(extractInviteUsernameFromLocation)
  const { confirm, dialog: confirmDialog } = useConfirm()
  const toastTimerRef = useRef()
  const selectedChatIdRef = useRef(selectedChatId)
  const socketRef = useRef(null)
  const profileSaveTimerRef = useRef(null)
  const callSignalHandlerRef = useRef(null)
  const callSocketCloseHandlerRef = useRef(null)
  const callSocketReadyHandlerRef = useRef(null)
  const pendingReadIdsRef = useRef(new Set())
  const stateRef = useRef(state)
  const selectChatRef = useRef(null)
  const loadMessagesRef = useRef(null)
  const loadServerWorkspaceRef = useRef(null)
  const [presence, setPresence] = useState({})
  const [typingByChat, setTypingByChat] = useState({})
  const [wallMessages, setWallMessages] = useState([])
  const [socketVersion, setSocketVersion] = useState(0)
  const [ui, setUi] = useState({
    contactsOpen: false,
    profileOpen: false,
    searchOpen: false,
    menuOpen: false,
    createSpace: '',
    mobilePane: 'list',
  })

  const sendSocketEvent = useCallback((payload) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(payload))
    }
  }, [])

  const showToast = useCallback((message) => {
    setToast(message)
    window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToast(''), 2200)
  }, [])

  useEffect(() => {
    if (auth.status !== 'authenticated' || !state.user?.id) return
    if (!hasCompletedPermissionOnboarding()) setPermissionPromptOpen(true)
  }, [auth.status, state.user?.id])

  // Sound + desktop notification for an incoming message (Telegram-style: quiet when you are reading the chat).
  const notifyIncoming = useCallback((message, chatId, senderId) => {
    const snapshot = stateRef.current
    if (!snapshot?.user || senderId === snapshot.user.id) return
    const settings = snapshot.settings || {}
    const isActiveChat = selectedChatIdRef.current === chatId && !document.hidden
    if (isActiveChat) return
    const chat = snapshot.chats.find((item) => item.id === chatId)
    const mentioned = messageMentionsCurrentUser(message.text, snapshot.user)
    if (!shouldNotifyForChat(chat, mentioned)) return
    if (settings.sound) playIncomingSound()
    if (settings.notifications) {
      const sender = snapshot.contacts.find((contact) => contact.id === senderId)
      showDesktopNotification({
        title: mentioned ? `${sender?.name || 'Onda'} mentioned you` : sender?.name || 'New message',
        body: notificationBody(message),
        tag: chatId,
        onClick: () => selectChatRef.current?.(chatId),
      })
    }
  }, [])

  const callController = useWebRTCCall({ sendSignal: sendSocketEvent, currentUser: state.user })

  useEffect(() => {
    callSignalHandlerRef.current = callController.handleSignal
    callSocketCloseHandlerRef.current = callController.handleSocketClose
    callSocketReadyHandlerRef.current = callController.handleSocketReady
  }, [callController.handleSignal, callController.handleSocketClose, callController.handleSocketReady])

  useEffect(() => {
    saveMessengerState(state)
  }, [state])

  useEffect(() => {
    return () => window.clearTimeout(profileSaveTimerRef.current)
  }, [])

  useEffect(() => {
    selectedChatIdRef.current = selectedChatId
  }, [selectedChatId])

  // Keep a fresh snapshot of state for use inside the long-lived WebSocket handler.
  useEffect(() => {
    stateRef.current = state
  })

  // Keep this browser's Web Push subscription aligned with the notification toggle.
  useEffect(() => {
    if (auth.status !== 'authenticated') return undefined
    if (!hasCompletedPermissionOnboarding()) return undefined

    let cancelled = false
    if (state.settings.notifications) {
      enableWebPushNotifications().catch(() => {
        if (!cancelled) ensureNotificationPermission()
      })
    } else {
      disableWebPushNotifications().catch(() => {})
    }

    return () => {
      cancelled = true
    }
  }, [auth.status, state.settings.notifications])

  // Load the live wall stream when the user turns the wallpaper on.
  useEffect(() => {
    if (auth.status !== 'authenticated' || !state.settings.liveWall?.enabled) return
    let cancelled = false
    getWallMessages()
      .then(({ messages }) => {
        if (!cancelled && Array.isArray(messages)) setWallMessages(messages)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [auth.status, state.settings.liveWall?.enabled])

  // Keep a fresh reference to the chat selector for notification click handling.
  useEffect(() => {
    selectChatRef.current = selectChat
  })

  // Keep fresh reference to loadMessages for WS reconnect use.
  useEffect(() => {
    loadMessagesRef.current = loadMessagesFromServer
  })

  // Keep fresh reference to workspace reload for the long-lived WebSocket handler.
  useEffect(() => {
    loadServerWorkspaceRef.current = loadServerWorkspace
  })

  useEffect(() => {
    let active = true
    getCurrentSession()
      .then(({ user }) => {
        if (!active) return
        completeAuthentication(user).catch((error) => {
          if (!active) return
          setAuth({ status: 'anonymous', user: null, error: error.message })
        })
      })
      .catch((error) => {
        if (!active) return
        setAuth({
          status: error.status === 401 ? 'anonymous' : 'anonymous',
          user: null,
          error: error.status === 401 ? '' : 'Server is unavailable. Start the backend and try again.',
        })
      })
    return () => {
      active = false
    }
    // Session bootstrap must run once; authentication handlers intentionally use the initial closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = state.settings.theme
  }, [state.settings.theme])

  useEffect(() => {
    if (state.settings.language) setLang(state.settings.language)
  }, [state.settings.language])

  useEffect(() => {
    if (auth.status !== 'authenticated') return undefined

    let reconnectTimer
    let shouldReconnect = true
    const wsUrl = API_BASE
      ? `${API_BASE.replace(/^http/, 'ws')}/ws`
      : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`
    const socket = new WebSocket(wsUrl)
    socketRef.current = socket

    socket.addEventListener('message', (event) => {
      let payload
      try {
        payload = JSON.parse(event.data)
      } catch {
        return
      }
      if (payload.type?.startsWith('call:')) {
        callSignalHandlerRef.current?.(payload)
        return
      }
      if (payload.type === 'wall:new' && payload.message) {
        setWallMessages((current) => {
          if (current.some((item) => item.id === payload.message.id)) return current
          return [...current.slice(-79), payload.message]
        })
        return
      }
      if (payload.type === 'session:ready') {
        callSocketReadyHandlerRef.current?.()
        const onlineIds = new Set(payload.onlineUserIds || [])
        setPresence((current) => {
          const next = { ...current }
          onlineIds.forEach((userId) => {
            next[userId] = { ...(next[userId] || {}), online: true }
          })
          return next
        })
        // Reload messages for the active chat on reconnect to catch missed messages
        const activeChatId = selectedChatIdRef.current
        if (activeChatId) {
          const activeChat = stateRef.current?.chats?.find((c) => c.id === activeChatId)
          if (activeChat?.backend) {
            loadMessagesRef.current?.(activeChatId)
          }
        }
        // Flush the offline queue after reconnect.
        resendFailedRef.current?.()
        return
      }

      if (payload.type === 'presence:update' && payload.userId) {
        setPresence((current) => ({
          ...current,
          [payload.userId]: {
            ...(current[payload.userId] || {}),
            online: payload.online,
            lastSeenAt: payload.lastSeenAt || current[payload.userId]?.lastSeenAt,
          },
        }))
        if (!payload.online) {
          setTypingByChat((current) => {
            return Object.fromEntries(
              Object.entries(current)
                .map(([chatId, userIds]) => [
                  chatId,
                  (Array.isArray(userIds) ? userIds : [userIds]).filter((userId) => userId !== payload.userId),
                ])
                .filter(([, userIds]) => userIds.length),
            )
          })
        }
        return
      }

      if (payload.type === 'typing:update' && payload.chatId) {
        setTypingByChat((current) => {
          const currentUserIds = Array.isArray(current[payload.chatId])
            ? current[payload.chatId]
            : current[payload.chatId]
              ? [current[payload.chatId]]
              : []
          if (payload.active) {
            if (currentUserIds.includes(payload.userId)) return current
            return { ...current, [payload.chatId]: [...currentUserIds, payload.userId] }
          }
          if (!currentUserIds.includes(payload.userId)) return current
          const remainingUserIds = currentUserIds.filter((userId) => userId !== payload.userId)
          const next = { ...current }
          if (remainingUserIds.length) {
            next[payload.chatId] = remainingUserIds
          } else {
            delete next[payload.chatId]
          }
          return next
        })
        return
      }

      if (payload.type === 'chat:settings' && payload.chatId && payload.settings) {
        setState((current) => ({
          ...current,
          chats: current.chats.map((chat) =>
            chat.id === payload.chatId
              ? {
                  ...chat,
                  pinned: Boolean(payload.settings.pinned),
                  pinnedAt: payload.settings.pinnedAt || null,
                  muted: Boolean(payload.settings.muted),
                  mutedUntil: payload.settings.mutedUntil || null,
                  archived: Boolean(payload.settings.archived),
                  archivedAt: payload.settings.archivedAt || null,
                  pushMode: payload.settings.pushMode || 'default',
                }
              : chat,
          ),
        }))
        return
      }

      if (payload.type === 'chat:auto-delete-changed' && payload.chatId) {
        setState((current) => ({
          ...current,
          chats: current.chats.map((chat) =>
            chat.id === payload.chatId
              ? { ...chat, autoDeleteSeconds: payload.autoDeleteSeconds ?? null }
              : chat,
          ),
        }))
        return
      }

      if (payload.type === 'security:event' && payload.event) {
        showToast(payload.event.title || 'Security alert')
        return
      }

      if (payload.type === 'user:block-updated' && payload.userId) {
        setState((current) => ({
          ...current,
          contacts: current.contacts.map((contact) =>
            contact.id === payload.userId
              ? { ...contact, blockedByMe: Boolean(payload.blockedByMe) }
              : contact,
          ),
          chats: current.chats.map((chat) => ({
            ...chat,
            members: chat.members?.map((member) =>
              member.id === payload.userId
                ? { ...member, blockedByMe: Boolean(payload.blockedByMe) }
                : member,
            ),
          })),
        }))
        return
      }

      if (payload.type === 'chat:pinned-message' && payload.chatId) {
        setState((current) => ({
          ...current,
          chats: current.chats.map((chat) =>
            chat.id === payload.chatId ? { ...chat, pinnedMessageId: payload.messageId } : chat,
          ),
        }))
        return
      }

      if (payload.type === 'chat:read' && payload.chatId && payload.userId) {
        setState((current) => {
          const msgs = current.messages[payload.chatId]
          if (!msgs) return current
          const upToSentAt = msgs.find((m) => m.id === payload.upToMessageId)?.time
          return {
            ...current,
            messages: {
              ...current.messages,
              [payload.chatId]: msgs.map((msg) => {
                if (
                  msg.senderId === current.user?.id &&
                  upToSentAt && msg.time <= upToSentAt &&
                  !msg.readBy?.some((r) => (r.userId || r) === payload.userId)
                ) {
                  return { ...msg, readBy: [...(msg.readBy || []), { userId: payload.userId, name: payload.userName || '' }] }
                }
                return msg
              }),
            },
          }
        })
        return
      }

      if (payload.type === 'message:delivered' && payload.chatId && payload.messageId) {
        setState((current) => ({
          ...current,
          messages: {
            ...current.messages,
            [payload.chatId]: (current.messages[payload.chatId] || []).map((message) =>
              message.id === payload.messageId && message.status !== 'read'
                ? { ...message, status: payload.delivered ? 'delivered' : 'sent' }
                : message,
            ),
          },
        }))
        return
      }

      if (payload.type === 'message:read' && payload.chatId) {
        const readIds = new Set(payload.messageIds || [])
        const reader = payload.userId && payload.userName
          ? { userId: payload.userId, name: payload.userName, username: payload.userUsername }
          : null
        readIds.forEach((messageId) => pendingReadIdsRef.current.add(messageId))
        setState((current) => ({
          ...current,
          messages: {
            ...current.messages,
            [payload.chatId]: (current.messages[payload.chatId] || []).map((message) => {
              if (!readIds.has(message.id)) return message
              const existingReadBy = message.readBy || []
              const alreadyRead = reader && existingReadBy.some((r) => r.userId === reader.userId)
              return {
                ...message,
                status: 'read',
                readBy: reader && !alreadyRead ? [...existingReadBy, reader] : existingReadBy,
              }
            }),
          },
        }))
        return
      }

      if (payload.type === 'chat:info-updated' && payload.chatId) {
        setState((current) => ({
          ...current,
          contacts: current.contacts.map((c) =>
            c.id === `entity-${payload.chatId}` ? { ...c, name: payload.title } : c,
          ),
        }))
        return
      }

      if (payload.type === 'chat:member-added' && payload.chatId) {
        // Reload workspace so member lists and encryption keys are fresh
        loadServerWorkspaceRef.current?.(state.user.id).catch(() => {})
        return
      }

      if (payload.type === 'chat:member-removed' && payload.chatId) {
        if (payload.userId === state.user.id) {
          // We were removed — drop the chat from local state
          setState((current) => ({
            ...current,
            chats: current.chats.filter((c) => c.id !== payload.chatId),
          }))
          if (selectedChatIdRef.current === payload.chatId) {
            setSelectedChatId('')
            setUi((current) => ({ ...current, mobilePane: 'list' }))
          }
        } else {
          loadServerWorkspaceRef.current?.(state.user.id).catch(() => {})
        }
        return
      }

      if (payload.type === 'chat:member-role' && payload.chatId && payload.userId) {
        patchChatMember(payload.chatId, payload.userId, {
          role: payload.role,
          permissions: payload.permissions || {},
        })
        return
      }

      if (payload.type === 'chat:member-permissions' && payload.chatId && payload.userId) {
        patchChatMember(payload.chatId, payload.userId, {
          permissions: payload.permissions || {},
        })
        return
      }

      if (payload.type === 'message:new' && payload.message?.chatId) {
        const messageChatId = payload.message.chatId
        if (!stateRef.current?.chats?.some((chat) => chat.id === messageChatId)) {
          loadServerWorkspaceRef.current?.(state.user.id).catch(() => {})
        }
        void normalizeServerMessage(payload.message, state.user.id).then((message) => {
          setState((current) => {
            const chatId = messageChatId
            const currentMessages = current.messages[chatId] || []
            if (currentMessages.some((item) => item.id === message.id)) return current

            const isActiveChat = selectedChatIdRef.current === chatId
            // Track first unread message id for the separator
            if (!isActiveChat && payload.message.senderId !== current.user?.id) {
              setUnreadFromId((prev) => prev[chatId] ? prev : { ...prev, [chatId]: message.id })
            }

            const isFromOther = payload.message.senderId !== current.user?.id
            const isMention = isFromOther && messageMentionsCurrentUser(message.text, current.user)
            const topicId = message.topicId

            return {
              ...current,
              chats: current.chats.map((chat) => {
                if (chat.id !== chatId || isActiveChat) return chat
                const topicUnreads = chat.topicUnreads || {}
                return {
                  ...chat,
                  unread: (chat.unread || 0) + (isFromOther ? 1 : 0),
                  mentions: (chat.mentions || 0) + (isMention ? 1 : 0),
                  topicUnreads: topicId
                    ? { ...topicUnreads, [topicId]: (topicUnreads[topicId] || 0) + (isFromOther ? 1 : 0) }
                    : topicUnreads,
                }
              }),
              messages: {
                ...current.messages,
                [chatId]: [...currentMessages, message],
              },
            }
          })
          notifyIncoming(message, payload.message.chatId, payload.message.senderId)
        })
        if (
          payload.message.senderId !== state.user.id &&
          selectedChatIdRef.current === payload.message.chatId
        ) {
          socket.send(JSON.stringify({ type: 'chat:read', chatId: payload.message.chatId }))
          markMessagesRead(payload.message.chatId, payload.message.id).catch(() => {})
        }
        return
      }

      if (!payload.chatId || !payload.messageId) return
      if (payload.type === 'message:edited') {
        void decryptTextForUser(payload.text || '', state.user.id).then((decrypted) => {
          setState((current) => ({
            ...current,
            messages: {
              ...current.messages,
              [payload.chatId]: (current.messages[payload.chatId] || []).map((message) =>
                message.id === payload.messageId
                  ? {
                      ...message,
                      text: decrypted.text,
                      encrypted: decrypted.encrypted,
                      decryptFailed: decrypted.failed,
                      edited: true,
                      editedAt: payload.editedAt,
                    }
                  : message,
              ),
            },
          }))
        })
        return
      }
      setState((current) => ({
        ...current,
        messages: {
          ...current.messages,
          [payload.chatId]: (current.messages[payload.chatId] || []).map((message) => {
            if (message.id !== payload.messageId) return message
            if (payload.type === 'message:deleted') {
              return {
                ...message,
                text: '',
                media: null,
                deleted: true,
                deletedAt: payload.deletedAt,
                replyToId: undefined,
                reactions: {},
              }
            }
            if (payload.type === 'message:reactions') {
              return { ...message, reactions: payload.reactions }
            }
            if (payload.type === 'message:poll' && message.id === payload.messageId) {
              return { ...message, poll: payload.poll }
            }
            return message
          }),
        },
      }))
    })
    socket.addEventListener('close', () => {
      if (socketRef.current === socket) socketRef.current = null
      callSocketCloseHandlerRef.current?.()
      if (shouldReconnect) {
        reconnectTimer = window.setTimeout(() => {
          setSocketVersion((current) => current + 1)
        }, 1500)
      }
    })

    return () => {
      shouldReconnect = false
      window.clearTimeout(reconnectTimer)
      if (socketRef.current === socket) socketRef.current = null
      socket.close()
    }
  }, [auth.status, notifyIncoming, showToast, socketVersion, state.user.id])

  async function loadServerWorkspace(currentUserId, currentUserPublicKey = state.user.encryptionPublicKey) {
    try {
      const [{ contacts: savedContacts }, { users }, { chats }, folderPayload] = await Promise.all([
        getContacts(),
        searchUsers(),
        getChats(),
        getChatFolders(),
      ])
      const savedContactIds = new Set((savedContacts || []).map((contact) => contact.id))
      const userById = new Map()
      ;[...(users || []), ...(savedContacts || [])].forEach((user) => {
        if (user.id !== currentUserId) userById.set(user.id, user)
      })
      const serverContacts = Array.from(userById.values())
        .map((user) => ({
          id: user.id,
          type: 'private',
          backend: true,
          name: user.name,
          username: `@${user.username}`,
          customStatus: user.status || '',
          avatar: user.avatar,
          color: '#3390ec',
          status: user.online ? 'online' : 'offline',
          lastSeen: user.online ? t('status.online') : formatLastSeen(user.lastSeenAt),
          lastSeenAt: user.lastSeenAt,
          encryptionPublicKey: user.encryptionPublicKey,
          blockedByMe: Boolean(user.blockedByMe),
          blockedMe: Boolean(user.blockedMe),
          isContact: Boolean(user.isContact || savedContactIds.has(user.id)),
          contactSince: user.contactSince || null,
          phone: '',
          bio: user.bio || 'Onda user',
        }))
      setPresence((current) => ({
        ...current,
        ...Object.fromEntries(
          users.map((user) => [
            user.id,
            {
              online: user.online,
              lastSeenAt: user.lastSeenAt,
            },
          ]),
        ),
      }))

      const entityContacts = []
      const serverChats = chats.map((chat) => {
        const counterpart = chat.members.find((member) => member.id !== currentUserId)
        let contactId

        if (chat.type === 'saved') {
          contactId = `saved-${chat.id}`
          entityContacts.push({
            id: contactId,
            type: 'private',
            backend: true,
            name: 'Saved Messages',
            username: '',
            avatar: 'SM',
            color: '#3390ec',
            status: 'saved',
            lastSeen: 'personal cloud',
            phone: '',
            bio: 'Messages visible only in your account.',
            encryptionPublicKey: currentUserPublicKey,
          })
        } else if (chat.type === 'private' && counterpart) {
          contactId = counterpart.id
        } else {
          contactId = `entity-${chat.id}`
          entityContacts.push({
            id: contactId,
            type: chat.type,
            backend: true,
            name: chat.title || (chat.type === 'group' ? 'Group' : 'Channel'),
            username: '',
            avatar: getInitials(chat.title),
            color: chat.type === 'group' ? '#14b8a6' : '#f97316',
            status: chat.type,
            lastSeen: `${chat.members.length} members`,
            phone: '',
            bio: '',
            members: chat.members.map((member) => member.id),
            role: chat.role,
          })
        }

        const chatSettings = chat.settings || {}
        return {
          id: chat.id,
          contactId,
          backend: true,
          serverType: chat.type,
          members: chat.members.map((member) => ({
            id: member.id,
            name: member.name,
            username: member.username,
            customStatus: member.status || '',
            role: member.role,
            permissions: member.permissions || {},
            encryptionPublicKey: member.encryptionPublicKey,
            blockedByMe: Boolean(member.blockedByMe),
            blockedMe: Boolean(member.blockedMe),
          })),
          pinned: Boolean(chatSettings.pinned),
          pinnedAt: chatSettings.pinnedAt || null,
          muted: Boolean(chatSettings.muted),
          mutedUntil: chatSettings.mutedUntil || null,
          archived: Boolean(chatSettings.archived),
          archivedAt: chatSettings.archivedAt || null,
          pushMode: chatSettings.pushMode || 'default',
          autoDeleteSeconds: chatSettings.autoDeleteSeconds ?? null,
          pinnedMessageId: chat.pinnedMessageId || null,
          linkedGroupId: chat.linkedGroupId || null,
          unread: chat.unreadCount ?? 0,
          createdAt: chat.created_at,
        }
      })

      setState((current) => ({
        ...current,
        contacts: [
          ...current.contacts.filter((contact) => !contact.backend),
          ...serverContacts,
          ...entityContacts,
        ],
        chats: [
          ...current.chats.filter((chat) => !chat.backend),
          ...serverChats,
        ],
        messages: {
          ...current.messages,
          ...Object.fromEntries(
            serverChats.map((chat) => [chat.id, current.messages[chat.id] || []]),
          ),
        },
        chatFolders: normalizeChatFolders(folderPayload),
      }))
    } catch {
      showToast('Could not load server chats.')
    }
  }

  async function completeAuthentication(user) {
    let encryptionPublicKey = user.encryptionPublicKey
    try {
      const keyPair = await ensureUserKeyPair(user.id)
      encryptionPublicKey = keyPair.publicKey
      if (!publicKeyEquals(user.encryptionPublicKey, keyPair.publicKey)) {
        const { user: updatedUser } = await updateEncryptionPublicKey(keyPair.publicKey)
        encryptionPublicKey = updatedUser.encryptionPublicKey || keyPair.publicKey
      }
    } catch {
      showToast('Encryption key setup failed.')
    }

    const appUser = {
      id: user.id,
      login: user.login,
      name: user.name,
      username: `@${user.username}`,
      bio: user.bio || '',
      customStatus: user.status || '',
      avatar: user.avatar,
      encryptionPublicKey,
      totpEnabled: Boolean(user.totpEnabled),
    }
    upsertAccount(appUser)
    setPrefillLogin(null)
    setState((current) => ({ ...current, user: appUser }))
    setAuth({ status: 'authenticated', user: appUser, error: '' })
    await loadServerWorkspace(user.id, encryptionPublicKey)
    getInstalledCustomEmojiPacks()
      .then(({ packs }) => {
        const map = {}
        for (const pack of packs) {
          for (const e of pack.emoji) map[e.shortcode] = e.imageUrl
        }
        setCustomEmojiMap(map)
      })
      .catch(() => {})
    try {
      const { events } = await getSecurityEvents({ unread: true })
      if (events?.length) {
        showToast(events.length === 1 ? events[0].title : `${events.length} unread security alerts`)
      }
    } catch {
      // Security alerts are secondary to signing in.
    }
  }

  async function handleTotpLogin({ code }) {
    const challenge = auth.totpChallenge
    if (!challenge) {
      setAuth({ status: 'anonymous', user: null, error: 'Login session expired. Try again.' })
      return
    }
    setAuth((current) => ({ ...current, status: 'pending', error: '' }))
    try {
      const { user, cloudPasswordRequired, hint } = await loginAccount({ ...challenge, totpCode: code })
      if (cloudPasswordRequired) {
        setAuth({
          status: 'cloudPassword',
          user: null,
          error: '',
          cloudChallenge: { ...challenge, totpCode: code, hint: hint || null },
        })
        return
      }
      await completeAuthentication(user)
    } catch (error) {
      setAuth((current) => ({
        ...current,
        status: 'totp',
        user: null,
        error: error.message,
        totpChallenge: challenge,
      }))
    }
  }

  async function handleLogin(input) {
    setAuth((current) => ({ ...current, status: 'pending', error: '' }))
    try {
      const { user, totpRequired, cloudPasswordRequired, hint } = await loginAccount(input)
      if (totpRequired) {
        setAuth({
          status: 'totp',
          user: null,
          error: '',
          totpChallenge: { login: input.login, password: input.password },
        })
        return
      }
      if (cloudPasswordRequired) {
        setAuth({
          status: 'cloudPassword',
          user: null,
          error: '',
          cloudChallenge: { login: input.login, password: input.password, hint: hint || null },
        })
        return
      }
      await completeAuthentication(user)
    } catch (error) {
      setAuth({ status: 'anonymous', user: null, error: error.message })
    }
  }

  async function handleCloudPasswordLogin({ cloudPassword }) {
    const challenge = auth.cloudChallenge
    if (!challenge) {
      setAuth({ status: 'anonymous', user: null, error: 'Login session expired. Try again.' })
      return
    }
    setAuth((current) => ({ ...current, status: 'pending', error: '' }))
    try {
      const result = challenge.type === 'phone'
        ? await verifyPhoneAuth({ ...challenge, cloudPassword })
        : await loginAccount({ ...challenge, cloudPassword })
      const { user } = result
      await completeAuthentication(user)
    } catch (error) {
      setAuth((current) => ({
        ...current,
        status: 'cloudPassword',
        user: null,
        error: error.message,
        cloudChallenge: challenge,
      }))
    }
  }

  function cancelTotpLogin() {
    setAuth({ status: 'anonymous', user: null, error: '' })
  }

  async function handleRegister(input) {
    setAuth((current) => ({ ...current, status: 'pending', error: '' }))
    try {
      const { user } = await registerAccount(input)
      await completeAuthentication(user)
    } catch (error) {
      setAuth({ status: 'anonymous', user: null, error: error.message })
    }
  }

  async function handlePhoneStart(input) {
    setAuth((current) => ({ ...current, status: 'pending', error: '' }))
    try {
      // On native (Capacitor) request push permission now so the code can arrive as a push notification.
      const fcmToken = await requestFcmTokenForAuth().catch(() => null)
      const result = await startPhoneAuth({ ...input, fcmToken: fcmToken || undefined })
      setAuth({ status: 'anonymous', user: null, error: '' })
      return result
    } catch (error) {
      setAuth({ status: 'anonymous', user: null, error: error.message })
      throw error
    }
  }

  async function handlePhoneVerify(input) {
    setAuth((current) => ({ ...current, status: 'pending', error: '' }))
    try {
      let payload = input
      if (input.username && input.name) {
        const keyPair = await ensureUserKeyPair(`phone:${input.countryCode}:${input.phone}:${input.username}`)
        payload = { ...input, encryptionPublicKey: keyPair.publicKey }
      }
      const result = await verifyPhoneAuth(payload)
      if (result.cloudPasswordRequired) {
        setAuth({
          status: 'cloudPassword',
          user: null,
          error: '',
          cloudChallenge: {
            type: 'phone',
            countryCode: input.countryCode,
            phone: input.phone,
            code: input.code,
            hint: result.hint || null,
          },
        })
        return result
      }
      if (result.profileRequired) {
        setAuth({ status: 'anonymous', user: null, error: '' })
        return result
      }
      await completeAuthentication(result.user)
      return result
    } catch (error) {
      setAuth({ status: 'anonymous', user: null, error: error.message })
      throw error
    }
  }

  async function handleLogout() {
    try {
      await disableWebPushNotifications()
      await logoutAccount()
    } finally {
      setAuth({ status: 'anonymous', user: null, error: '' })
      setSelectedFolderId('all')
      setUi((current) => ({ ...current, menuOpen: false, mobilePane: 'list' }))
    }
  }

  async function handleSwitchAccount(account) {
    setPrefillLogin(account.username.replace(/^@/, ''))
    try {
      await disableWebPushNotifications()
      await logoutAccount()
    } finally {
      setAuth({ status: 'anonymous', user: null, error: '' })
      setSelectedFolderId('all')
      setUi((current) => ({ ...current, menuOpen: false, mobilePane: 'list' }))
    }
  }

  async function handleAddAccount() {
    setPrefillLogin(null)
    try {
      await disableWebPushNotifications()
      await logoutAccount()
    } finally {
      setAuth({ status: 'anonymous', user: null, error: '' })
      setSelectedFolderId('all')
      setUi((current) => ({ ...current, menuOpen: false, mobilePane: 'list' }))
    }
  }

  function handleRemoveAccount(accountId) {
    removeAccount(accountId)
  }

  async function uploadUserAvatar(file) {
    try {
      await uploadAvatar(file)
      bumpAvatarCache()
      showToast('Profile photo updated.')
    } catch (error) {
      showToast(error.message || 'Profile photo was not updated.')
    }
  }

  async function removeUserAvatar() {
    try {
      await deleteAvatar()
      bumpAvatarCache()
      showToast('Profile photo removed.')
    } catch (error) {
      showToast(error.message || 'Profile photo was not removed.')
    }
  }

  // Throws on failure so the settings form can show inline status.
  async function changeUserPassword(input) {
    await changePassword(input)
    showToast('Password changed. Other sessions were signed out.')
  }

  async function removeAccount() {
    try {
      await deleteAccount()
    } finally {
      resetMessengerState()
      setState(fallbackState)
      setSelectedChatId('')
      setSelectedFolderId('all')
      setAuth({ status: 'anonymous', user: null, error: '' })
      setUi((current) => ({ ...current, menuOpen: false, mobilePane: 'list' }))
      showToast('Account deleted.')
    }
  }

  useEffect(() => {
    const handler = (event) => showToast(event.detail)
    window.addEventListener('astrachat:toast', handler)
    return () => window.removeEventListener('astrachat:toast', handler)
  }, [showToast])

  useEffect(() => {
    const handleUpdate = () => showToast('Update available — reload to apply.')
    const handleOpenChat = (e) => {
      const chatId = e.detail?.chatId
      if (chatId) selectChatRef.current?.(chatId)
    }
    window.addEventListener('astrachat:update-ready', handleUpdate)
    window.addEventListener('astrachat:open-chat', handleOpenChat)
    return () => {
      window.removeEventListener('astrachat:update-ready', handleUpdate)
      window.removeEventListener('astrachat:open-chat', handleOpenChat)
    }
  }, [showToast])

  useEffect(() => {
    if (auth.status !== 'authenticated') return
    const params = new URLSearchParams(window.location.search)
    const chatId = params.get('chat')
    if (!chatId || !state.chats.some((chat) => chat.id === chatId)) return
    params.delete('chat')
    const query = params.toString()
    window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
    selectChatRef.current?.(chatId)
  }, [auth.status, state.chats])

  useEffect(() => {
    if (auth.status !== 'authenticated') return
    const params = new URLSearchParams(window.location.search)
    const qrToken = params.get('token')
    if (!qrToken || window.location.pathname !== '/qr-login') return
    window.history.replaceState({}, '', '/')
    confirm('Allow login from another device?', { confirmLabel: 'Allow', cancelLabel: 'Deny' }).then((ok) => {
      if (!ok) return
      confirmQrLogin(qrToken)
        .then(() => showToast('Login confirmed.'))
        .catch(() => showToast('QR token expired or invalid.'))
    })
  }, [auth.status, confirm, showToast])

  const chatSummaries = useMemo(() => {
    return state.chats
      .map((chat) => {
        const baseContact = state.contacts.find((item) => item.id === chat.contactId)
        const live = presence[chat.contactId]
        const typingUserIds = Array.isArray(typingByChat[chat.id])
          ? typingByChat[chat.id]
          : typingByChat[chat.id]
            ? [typingByChat[chat.id]]
            : []
        const isGroupLike = baseContact?.type === 'group' || baseContact?.type === 'channel'
        const isTyping = isGroupLike
          ? typingUserIds.some((userId) => userId !== state.user.id)
          : typingUserIds.includes(chat.contactId)
        const typingNames = isGroupLike
          ? typingUserIds
              .filter((userId) => userId !== state.user.id)
              .map((userId) => state.contacts.find((c) => c.id === userId)?.name)
              .filter(Boolean)
          : []
        const groupTypingLabel = typingNames.length
          ? typingNames.length === 1
            ? `${typingNames[0]} ${t('status.typing')}`
            : `${typingNames.length} ${t('status.typing')}`
          : ''
        const contact =
          baseContact?.backend && baseContact.type === 'private' && baseContact.status !== 'saved'
            ? {
                ...baseContact,
                status: isTyping ? 'typing' : live?.online ? 'online' : 'offline',
                lastSeen: isTyping
                  ? t('status.typing')
                  : live?.online
                    ? t('status.online')
                    : formatLastSeen(live?.lastSeenAt || baseContact.lastSeenAt),
              }
            : baseContact?.backend && isGroupLike
              ? {
                  ...baseContact,
                  status: isTyping ? 'typing' : baseContact.status,
                  lastSeen: isTyping ? groupTypingLabel : baseContact.lastSeen,
                }
              : baseContact
        const chatMessages = state.messages[chat.id] || []
        const lastMessage = getLastMessage(chatMessages)
        return {
          ...chat,
          contact,
          lastMessageText: lastMessage?.text || '',
          lastMessageTime: lastMessage?.time || chat.createdAt,
        }
      })
      .filter((chat) => chat.contact)
      .sort(byPinnedThenRecent)
  }, [presence, state.chats, state.contacts, state.messages, state.user.id, typingByChat])

  // Reflect total unread count in the browser tab title and favicon badge.
  useEffect(() => {
    const totalUnread = chatSummaries.reduce((sum, chat) => sum + (chat.unread || 0), 0)
    document.title = totalUnread > 0 ? `(${totalUnread}) ${APP_TITLE}` : APP_TITLE

    const link = document.querySelector("link[rel~='icon']")
    if (!link) return
    if (totalUnread === 0) {
      link.href = '/favicon.svg'
      return
    }
    const canvas = document.createElement('canvas')
    canvas.width = 32
    canvas.height = 32
    const ctx = canvas.getContext('2d')
    const img = new Image()
    img.onload = () => {
      ctx.drawImage(img, 0, 0, 32, 32)
      // Red badge circle
      const label = totalUnread > 99 ? '99+' : String(totalUnread)
      const r = label.length > 1 ? 10 : 8
      ctx.beginPath()
      ctx.arc(26, 6, r, 0, Math.PI * 2)
      ctx.fillStyle = '#ef4444'
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.font = `bold ${label.length > 1 ? 9 : 11}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, 26, 6)
      link.href = canvas.toDataURL()
    }
    img.src = '/favicon.svg'
  }, [chatSummaries])

  // Open a chat from an invite link (?add=username) once the workspace has loaded.
  useEffect(() => {
    if (auth.status !== 'authenticated' || !pendingInvite) return
    const myUsername = String(state.user.username || '').replace(/^@/, '').toLowerCase()
    let timer = 0
    if (pendingInvite === myUsername) {
      timer = window.setTimeout(() => {
        showToast('This is your own invite link.')
        setPendingInvite('')
      }, 0)
      return () => window.clearTimeout(timer)
    }
    const contact = state.contacts.find(
      (item) =>
        item.backend &&
        String(item.username || '').replace(/^@/, '').toLowerCase() === pendingInvite,
    )
    if (contact) {
      timer = window.setTimeout(() => {
        setPendingInvite('')
        createChat(contact.id)
      }, 0)
    }
    return () => window.clearTimeout(timer)
    // Re-runs as contacts load; intentionally minimal deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status, pendingInvite, state.contacts, state.user.username])

  const liveWallEnabled = Boolean(state.settings.liveWall?.enabled)
  const liveWallChatWords = useMemo(
    () => (liveWallEnabled ? extractAllChatWords(state.messages) : []),
    [liveWallEnabled, state.messages],
  )

  const wordStreamWords = useMemo(
    () =>
      extractPrivateWordStream({
        messages: state.messages,
        currentUser: state.user,
        contacts: state.contacts,
      }),
    [state.contacts, state.messages, state.user],
  )

  const selectedChat = state.chats.find((chat) => chat.id === selectedChatId)
  const selectedContact = selectedChat
    ? chatSummaries.find((chat) => chat.id === selectedChat.id)?.contact || null
    : null
  const messages = selectedChat ? state.messages[selectedChat.id] || [] : []
  const selectedTypingUsers = useMemo(() => {
    const userIds = Array.isArray(typingByChat[selectedChatId])
      ? typingByChat[selectedChatId]
      : typingByChat[selectedChatId]
        ? [typingByChat[selectedChatId]]
        : []
    return userIds
      .filter((userId) => userId !== state.user.id)
      .map((userId) => state.contacts.find((contact) => contact.id === userId) || { id: userId, name: 'Someone' })
  }, [selectedChatId, state.contacts, state.user.id, typingByChat])
  const replyTo = messages.find((message) => message.id === replyToId)
  const editingMessage = messages.find((message) => message.id === editingMessageId)

  async function getChatEncryptionRecipients(chat) {
    const keyPair = await ensureUserKeyPair(state.user.id)
    const recipientsById = new Map([
      [
        state.user.id,
        {
          id: state.user.id,
          encryptionPublicKey: state.user.encryptionPublicKey || keyPair.publicKey,
        },
      ],
    ])

    if (chat.serverType === 'saved') return Array.from(recipientsById.values())

    const members = chat.members || []
    members.forEach((member) => {
      if (member.id === state.user.id) return
      recipientsById.set(member.id, {
        id: member.id,
        encryptionPublicKey: member.encryptionPublicKey,
      })
    })

    const fallbackContact = state.contacts.find((contact) => contact.id === chat.contactId)
    if (!members.length && fallbackContact?.id) {
      recipientsById.set(fallbackContact.id, {
        id: fallbackContact.id,
        encryptionPublicKey: fallbackContact.encryptionPublicKey,
      })
    }

    const missingKey = Array.from(recipientsById.values()).find(
      (recipient) => !recipient.encryptionPublicKey,
    )
    if (missingKey) {
      throw new Error('Encryption key is missing for this chat. Ask this user to sign in again.')
    }
    return Array.from(recipientsById.values())
  }

  async function encryptTextForChat(text, chat) {
    if (!chat.backend || !text) return text
    const recipients = await getChatEncryptionRecipients(chat)
    return encryptTextForRecipients(text, recipients)
  }

  async function encryptMediaForChat(file, chat) {
    const recipients = await getChatEncryptionRecipients(chat)
    const prepared = await prepareClientMediaFile(file)
    const encrypted = await encryptBlobForRecipients(prepared.blob, recipients)
    const encryptedFile = new File([encrypted.blob], `${file.name}.astra`, {
      type: 'application/octet-stream',
    })
    return {
      file: encryptedFile,
      metadata: {
        clientEncrypted: true,
        envelope: encrypted.envelope,
        kind: prepared.kind,
        mimeType: prepared.mimeType,
        plainSize: prepared.blob.size,
        originalSize: prepared.originalSize,
        originalName: file.name,
        width: prepared.width,
        height: prepared.height,
        durationMs: prepared.durationMs ?? null,
      },
      compressed: prepared.compressed,
    }
  }

  async function loadMessagesFromServer(chatId, { before, append } = {}) {
    try {
      const { messages: serverMessages, hasMore } = await getChatMessages(chatId, { before, limit: 50 })
      const normalizedMessages = await Promise.all(
        serverMessages.map((message) => normalizeServerMessage(message, state.user.id)),
      )
      setHasMoreMessages((current) => ({ ...current, [chatId]: Boolean(hasMore) }))
      setState((current) => ({
        ...current,
        messages: {
          ...current.messages,
          [chatId]: append
            ? [...normalizedMessages, ...(current.messages[chatId] || [])]
            : normalizedMessages,
        },
      }))
      if (!append) {
        sendSocketEvent({ type: 'chat:read', chatId })
        // Also mark as read via HTTP API so the server can update readBy on messages
        if (normalizedMessages.length > 0) {
          const lastMsg = normalizedMessages[normalizedMessages.length - 1]
          markMessagesRead(chatId, lastMsg.id).catch(() => {})
        }
      }
    } catch (error) {
      showToast(error.message || 'Could not load messages.')
    }
  }

  async function loadMoreMessages() {
    if (!selectedChat?.backend) return
    const currentMessages = state.messages[selectedChat.id] || []
    if (!currentMessages.length) return
    const oldest = currentMessages[0]
    await loadMessagesFromServer(selectedChat.id, { before: oldest.time, append: true })
  }

  async function jumpToMessage(messageId) {
    if (!selectedChat || !messageId) return
    const currentMessages = stateRef.current?.messages?.[selectedChat.id] || []
    if (currentMessages.some((message) => message.id === messageId)) {
      setSelectedMessageId(messageId)
      return
    }
    if (!selectedChat.backend) {
      showToast('This message is not loaded locally.')
      return
    }

    try {
      const { messages: serverMessages, hasMoreBefore } = await getChatMessageContext(
        selectedChat.id,
        messageId,
        { limit: 51 },
      )
      const normalizedMessages = await Promise.all(
        serverMessages.map((message) => normalizeServerMessage(message, state.user.id)),
      )
      if (!normalizedMessages.some((message) => message.id === messageId)) {
        throw new Error('Message is not available.')
      }
      setState((current) => ({
        ...current,
        messages: {
          ...current.messages,
          [selectedChat.id]: mergeMessagesById(current.messages[selectedChat.id], normalizedMessages),
        },
      }))
      setHasMoreMessages((current) => ({
        ...current,
        [selectedChat.id]: Boolean(hasMoreBefore || current[selectedChat.id]),
      }))
      setSelectedMessageId(messageId)
      sendSocketEvent({ type: 'chat:read', chatId: selectedChat.id })
    } catch (error) {
      showToast(error.message || 'Could not open message.')
    }
  }

  function selectChat(chatId) {
    const chat = state.chats.find((item) => item.id === chatId)
    setSelectedChatId(chatId)
    setMessageSearch('')
    setSelectedMessageId('')
    setSelectedMessageIds(new Set())
    setReplyToId('')
    setEditingMessageId('')
    setForwardSource(null)
    setUi((current) => ({
      ...current,
      mobilePane: 'chat',
      searchOpen: false,
      profileOpen: false,
      menuOpen: false,
    }))
    setState((current) => ({
      ...current,
      chats: current.chats.map((chat) => (chat.id === chatId ? { ...chat, unread: 0, mentions: 0, topicUnreads: {} } : chat)),
    }))
    setUnreadFromId((current) => {
      if (!current[chatId]) return current
      const next = { ...current }
      delete next[chatId]
      return next
    })
    if (chat?.backend) {
      loadMessagesFromServer(chatId)
      sendSocketEvent({ type: 'chat:read', chatId })
    }
  }

  function startForwardCompose(message, targetChatId) {
    selectChat(targetChatId)
    setForwardSource(message)
  }

  function clearForwardCompose() {
    setForwardSource(null)
  }

  const handleTyping = useCallback(
    (active) => {
      if (!selectedChat?.backend) return
      sendSocketEvent({ type: 'typing', chatId: selectedChat.id, active })
    },
    [selectedChat?.backend, selectedChat?.id, sendSocketEvent],
  )

  async function sendMessage(text, linkPreview, topicId) {
    if (!selectedChat) return

    if (editingMessage) {
      if (selectedChat.backend) {
        try {
          const encryptedText = await encryptTextForChat(text, selectedChat)
          await editChatMessage(selectedChat.id, editingMessage.id, encryptedText, text)
          setEditingMessageId('')
          showToast('Message edited.')
        } catch (error) {
          showToast(error.message || 'Message was not edited.')
        }
        return
      }

      setState((current) => ({
        ...current,
        messages: {
          ...current.messages,
          [selectedChat.id]: current.messages[selectedChat.id].map((message) =>
            message.id === editingMessage.id
              ? { ...message, text, edited: true, time: new Date().toISOString() }
              : message,
          ),
        },
      }))
      setEditingMessageId('')
      showToast('Message edited.')
      return
    }

    if (forwardSource) {
      const sourceText = getMessagePlainText(forwardSource).trim()
      const mergedText = text.trim() || sourceText

      let payloadText = mergedText
      if (selectedChat.backend) {
        try {
          payloadText = await encryptTextForChat(mergedText, selectedChat)
        } catch (error) {
          showToast(error.message || 'Message was not encrypted.')
          return
        }
      }

      const id = createId('fwd-compose')
      const now = new Date().toISOString()
      const localMessage = {
        id,
        senderId: state.user.id,
        text: mergedText,
        time: now,
        status: selectedChat.backend ? 'sending' : 'read',
        reactions: {},
        forwarded: true,
      }

      setState((current) => ({
        ...current,
        messages: {
          ...current.messages,
          [selectedChat.id]: [...(current.messages[selectedChat.id] || []), localMessage],
        },
      }))
      const sourceMsg = forwardSource
      setForwardSource(null)

      if (selectedChat.backend) {
        try {
          const { message } = await sendChatMessage(selectedChat.id, {
            text: payloadText,
            searchText: mergedText,
            forwardedFromMessageId: sourceMsg.backend ? sourceMsg.id : undefined,
          })
          const normalizedMessage = await normalizeServerMessage(message, state.user.id)
          setState((current) => ({
            ...current,
            messages: {
              ...current.messages,
              [selectedChat.id]: (current.messages[selectedChat.id] || []).map((item) =>
                item.id === id ? { ...normalizedMessage, forwarded: true } : item,
              ),
            },
          }))
        } catch (error) {
          setState((current) => ({
            ...current,
            messages: {
              ...current.messages,
              [selectedChat.id]: (current.messages[selectedChat.id] || []).map((item) =>
                item.id === id ? { ...item, status: 'failed' } : item,
              ),
            },
          }))
          showToast(error.message || 'Message was not sent.')
        }
      }
      return
    }

    let payloadText = text
    if (selectedChat.backend) {
      try {
        payloadText = await encryptTextForChat(text, selectedChat)
      } catch (error) {
        showToast(error.message || 'Message was not encrypted.')
        return
      }
    }

    const id = createId('msg')
    const now = new Date().toISOString()
    const newMessage = {
      id,
      senderId: state.user.id,
      text,
      time: now,
      status: 'sending',
      replyToId: replyTo?.id,
      reactions: {},
      linkPreview: linkPreview || null,
    }

    setState((current) => ({
      ...current,
      messages: {
        ...current.messages,
        [selectedChat.id]: [...(current.messages[selectedChat.id] || []), newMessage],
      },
    }))
    setReplyToId('')

    if (selectedChat.backend) {
      try {
        const { message } = await sendChatMessage(selectedChat.id, {
          text: payloadText,
          searchText: text,
          replyToId: replyTo?.id,
          linkPreview: linkPreview || undefined,
          topicId: topicId || undefined,
        })
        const normalizedMessage = await normalizeServerMessage(message, state.user.id)
        if (pendingReadIdsRef.current.has(normalizedMessage.id)) {
          normalizedMessage.status = 'read'
          pendingReadIdsRef.current.delete(normalizedMessage.id)
        }
        setState((current) => ({
          ...current,
          messages: {
            ...current.messages,
            [selectedChat.id]: (() => {
              const currentMessages = current.messages[selectedChat.id] || []
              if (currentMessages.some((item) => item.id === normalizedMessage.id)) {
                return currentMessages.filter((item) => item.id !== id)
              }
              return currentMessages.map((item) =>
                item.id === id ? normalizedMessage : item,
              )
            })(),
          },
        }))
      } catch (error) {
        setState((current) => ({
          ...current,
          messages: {
            ...current.messages,
            [selectedChat.id]: (current.messages[selectedChat.id] || []).map((item) =>
              item.id === id ? { ...item, status: 'failed' } : item,
            ),
          },
        }))
        scheduleRetry(id, selectedChat.id)
        showToast(error.message || 'Message was not sent.')
      }
      return
    }

    window.setTimeout(() => updateMessageStatus(selectedChat.id, id, 'sent'), 450)
    window.setTimeout(() => updateMessageStatus(selectedChat.id, id, 'delivered'), 900)
    window.setTimeout(() => updateMessageStatus(selectedChat.id, id, 'read'), 1500)
  }

  async function sendRichMessage(rich) {
    if (!selectedChat || editingMessage) return

    // Polls are sent as real server messages with a poll payload, not as rich text
    if (rich.type === 'poll' && selectedChat.backend) {
      try {
        const { message } = await sendChatMessage(selectedChat.id, {
          text: '',
          searchText: rich.poll?.question || '',
          poll: rich.poll,
        })
        const normalizedMessage = await normalizeServerMessage(message, state.user.id)
        setState((current) => ({
          ...current,
          messages: {
            ...current.messages,
            [selectedChat.id]: [...(current.messages[selectedChat.id] || []), normalizedMessage],
          },
        }))
      } catch (error) {
        showToast(error.message || 'Poll could not be sent.')
      }
      return
    }

    const text = rich.caption || ''
    const searchText = getRichSearchText(rich)
    const encoded = encodeRichMessage(rich)
    let payloadText = encoded
    if (selectedChat.backend) {
      try {
        payloadText = await encryptTextForChat(encoded, selectedChat)
      } catch (error) {
        showToast(error.message || 'Message was not encrypted.')
        return
      }
    }

    const id = createId('rich')
    const localMessage = {
      id,
      senderId: state.user.id,
      text,
      rich,
      time: new Date().toISOString(),
      status: selectedChat.backend ? 'sending' : 'read',
      replyToId: replyTo?.id,
      reactions: {},
    }
    setState((current) => ({
      ...current,
      messages: {
        ...current.messages,
        [selectedChat.id]: [...(current.messages[selectedChat.id] || []), localMessage],
      },
    }))
    setReplyToId('')

    if (!selectedChat.backend) return

    try {
      const { message } = await sendChatMessage(selectedChat.id, {
        text: payloadText,
        searchText,
        replyToId: replyTo?.id,
      })
      const normalizedMessage = await normalizeServerMessage(message, state.user.id)
      setState((current) => ({
        ...current,
        messages: {
          ...current.messages,
          [selectedChat.id]: (current.messages[selectedChat.id] || []).map((item) =>
            item.id === id ? normalizedMessage : item,
          ),
        },
      }))
    } catch (error) {
      setState((current) => ({
        ...current,
        messages: {
          ...current.messages,
          [selectedChat.id]: (current.messages[selectedChat.id] || []).map((item) =>
            item.id === id ? { ...item, status: 'failed' } : item,
          ),
        },
      }))
      showToast(error.message || 'Rich message was not sent.')
    }
  }

  async function forwardMessageToChat(sourceMessage, targetChatId) {
    const targetChat = state.chats.find((chat) => chat.id === targetChatId)
    if (!targetChat || !sourceMessage || sourceMessage.deleted) return
    const text = getMessagePlainText(sourceMessage).trim()
    if (!text) {
      showToast('Only text forwarding is available for encrypted media.')
      return
    }

    const forwardedText = text
    let payloadText = forwardedText
    if (targetChat.backend) {
      try {
        payloadText = await encryptTextForChat(forwardedText, targetChat)
      } catch (error) {
        showToast(error.message || 'Message was not encrypted.')
        return
      }
    }

    const localId = createId('fwd')
    const localMessage = {
      id: localId,
      senderId: state.user.id,
      text: forwardedText,
      time: new Date().toISOString(),
      status: targetChat.backend ? 'sending' : 'read',
      reactions: {},
      forwarded: true,
    }
    setState((current) => ({
      ...current,
      messages: {
        ...current.messages,
        [targetChat.id]: [...(current.messages[targetChat.id] || []), localMessage],
      },
    }))

    if (!targetChat.backend) {
      showToast('Message forwarded locally.')
      return
    }

    try {
      const { message } = await sendChatMessage(targetChat.id, {
        text: payloadText,
        searchText: forwardedText,
        forwardedFromMessageId: sourceMessage.backend ? sourceMessage.id : undefined,
      })
      const normalizedMessage = await normalizeServerMessage(message, state.user.id)
      setState((current) => ({
        ...current,
        messages: {
          ...current.messages,
          [targetChat.id]: (current.messages[targetChat.id] || []).map((item) =>
            item.id === localId ? { ...normalizedMessage, forwarded: true } : item,
          ),
        },
      }))
      showToast('Message forwarded.')
    } catch (error) {
      setState((current) => ({
        ...current,
        messages: {
          ...current.messages,
          [targetChat.id]: (current.messages[targetChat.id] || []).map((item) =>
            item.id === localId ? { ...item, status: 'failed' } : item,
          ),
        },
      }))
      showToast(error.message || 'Message was not forwarded.')
    }
  }


  function updateMessageStatus(chatId, messageId, status) {
    setState((current) => ({
      ...current,
      messages: {
        ...current.messages,
        [chatId]: (current.messages[chatId] || []).map((message) =>
          message.id === messageId ? { ...message, status } : message,
        ),
      },
    }))
  }

  function startReply(message) {
    setReplyToId(message.id)
    setEditingMessageId('')
    setSelectedMessageId('')
  }

  function startEdit(message) {
    if (message.senderId !== state.user.id) return
    setEditingMessageId(message.id)
    setReplyToId('')
    setSelectedMessageId('')
  }

  async function deleteMessage(messageId) {
    if (!selectedChat) return
    if (selectedChat.backend) {
      const message = (state.messages[selectedChat.id] || []).find((item) => item.id === messageId)
      try {
        if (message?.senderId === state.user.id) {
          await deleteChatMessage(selectedChat.id, messageId)
          showToast('Message deleted for everyone.')
        } else {
          await deleteChatMessageForMe(selectedChat.id, messageId)
          setState((current) => ({
            ...current,
            messages: {
              ...current.messages,
              [selectedChat.id]: (current.messages[selectedChat.id] || []).filter(
                (item) => item.id !== messageId,
              ),
            },
          }))
          showToast('Message deleted for you.')
        }
        setSelectedMessageId('')
      } catch (error) {
        showToast(error.message || 'Message was not deleted.')
      }
      return
    }

    setState((current) => ({
      ...current,
      messages: {
        ...current.messages,
        [selectedChat.id]: current.messages[selectedChat.id].map((message) =>
          message.id === messageId
            ? { ...message, deleted: true, text: '', reactions: {}, replyToId: undefined }
            : message,
        ),
      },
    }))
    setSelectedMessageId('')
    showToast('Message deleted locally.')
  }

  async function copyMessage(message) {
    const text = getMessagePlainText(message)
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      showToast('Message copied.')
    } catch {
      showToast('Clipboard is unavailable in this browser.')
    }
    setSelectedMessageId('')
  }

  async function reactToMessage(messageId, emoji) {
    if (!selectedChat) return
    if (selectedChat.backend) {
      try {
        await toggleMessageReaction(selectedChat.id, messageId, emoji)
        setSelectedMessageId('')
      } catch (error) {
        showToast(error.message || 'Reaction was not updated.')
      }
      return
    }

    setState((current) => ({
      ...current,
      messages: {
        ...current.messages,
        [selectedChat.id]: current.messages[selectedChat.id].map((message) => {
          if (message.id !== messageId) return message
          const currentCount = message.reactions?.[emoji] || 0
          return {
            ...message,
            reactions: {
              ...(message.reactions || {}),
              [emoji]: currentCount ? 0 : 1,
            },
          }
        }),
      },
    }))
  }

  function applyServerChatSettings(chatId, settings) {
    setState((current) => ({
      ...current,
      chats: current.chats.map((chat) =>
        chat.id === chatId
          ? {
              ...chat,
              pinned: Boolean(settings.pinned),
              pinnedAt: settings.pinnedAt || null,
              muted: Boolean(settings.muted),
              mutedUntil: settings.mutedUntil || null,
              archived: Boolean(settings.archived),
              archivedAt: settings.archivedAt || null,
              pushMode: settings.pushMode || 'default',
              autoDeleteSeconds: 'autoDeleteSeconds' in settings ? (settings.autoDeleteSeconds ?? null) : chat.autoDeleteSeconds,
            }
          : chat,
      ),
    }))
  }

  async function toggleChatField(chatId, field) {
    const chat = state.chats.find((item) => item.id === chatId)
    if (!chat) return
    const nextValue = !chat[field]
    setState((current) => ({
      ...current,
      chats: current.chats.map((item) => (item.id === chatId ? { ...item, [field]: nextValue } : item)),
    }))
    if (!chat.backend) return

    try {
      const patch = field === 'muted' ? { muted: nextValue } : { [field]: nextValue }
      const { settings } = await updateChatSettings(chatId, patch)
      applyServerChatSettings(chatId, settings)
    } catch (error) {
      setState((current) => ({
        ...current,
        chats: current.chats.map((item) => (item.id === chatId ? { ...item, [field]: chat[field] } : item)),
      }))
      showToast(error.message || 'Chat setting was not saved.')
    }
  }

  async function archiveChat(chatId) {
    const chat = state.chats.find((item) => item.id === chatId)
    if (!chat) return
    const nextArchived = !chat.archived
    setState((current) => ({
      ...current,
      chats: current.chats.map((chat) =>
        chat.id === chatId ? { ...chat, archived: nextArchived, unread: 0 } : chat,
      ),
    }))
    if (nextArchived && selectedChatId === chatId) {
      setSelectedChatId('')
      setUi((current) => ({ ...current, mobilePane: 'list', profileOpen: false }))
    }
    if (!chat.backend) return

    try {
      const { settings } = await updateChatSettings(chatId, { archived: nextArchived })
      applyServerChatSettings(chatId, settings)
    } catch (error) {
      setState((current) => ({
        ...current,
        chats: current.chats.map((item) =>
          item.id === chatId ? { ...item, archived: chat.archived } : item,
        ),
      }))
      showToast(error.message || 'Archive state was not saved.')
    }
  }

  async function pinMessage(messageId) {
    if (!selectedChat?.backend) return
    const nextId = messageId || null
    setState((current) => ({
      ...current,
      chats: current.chats.map((chat) =>
        chat.id === selectedChat.id ? { ...chat, pinnedMessageId: nextId } : chat,
      ),
    }))
    try {
      await pinChatMessage(selectedChat.id, nextId)
      showToast(nextId ? 'Message pinned.' : 'Message unpinned.')
    } catch (error) {
      setState((current) => ({
        ...current,
        chats: current.chats.map((chat) =>
          chat.id === selectedChat.id ? { ...chat, pinnedMessageId: selectedChat.pinnedMessageId } : chat,
        ),
      }))
      showToast(error.message || 'Could not update pinned message.')
    }
  }

  async function muteChat(chatId, mutedUntil) {
    const chat = state.chats.find((item) => item.id === chatId)
    if (!chat) return
    const isMuting = mutedUntil !== null
    setState((current) => ({
      ...current,
      chats: current.chats.map((item) =>
        item.id === chatId ? { ...item, muted: isMuting, mutedUntil: mutedUntil || null } : item,
      ),
    }))
    if (!chat.backend) return
    try {
      const { settings } = await updateChatSettings(chatId, { muted: isMuting, mutedUntil })
      applyServerChatSettings(chatId, settings)
    } catch (error) {
      setState((current) => ({
        ...current,
        chats: current.chats.map((item) =>
          item.id === chatId ? { ...item, muted: chat.muted, mutedUntil: chat.mutedUntil } : item,
        ),
      }))
      showToast(error.message || 'Mute setting was not saved.')
    }
  }

  async function setChatPushMode(chatId, pushMode) {
    const chat = state.chats.find((item) => item.id === chatId)
    if (!chat) return
    const previousMode = chat.pushMode || 'default'
    setState((current) => ({
      ...current,
      chats: current.chats.map((item) => (item.id === chatId ? { ...item, pushMode } : item)),
    }))
    if (!chat.backend) return

    try {
      const { settings } = await updateChatSettings(chatId, { pushMode })
      applyServerChatSettings(chatId, settings)
    } catch (error) {
      setState((current) => ({
        ...current,
        chats: current.chats.map((item) =>
          item.id === chatId ? { ...item, pushMode: previousMode } : item,
        ),
      }))
      showToast(error.message || 'Push setting was not saved.')
    }
  }

  async function setChatAutoDelete(chatId, autoDeleteSeconds) {
    const chat = state.chats.find((item) => item.id === chatId)
    if (!chat?.backend) return
    setState((current) => ({
      ...current,
      chats: current.chats.map((item) =>
        item.id === chatId ? { ...item, autoDeleteSeconds: autoDeleteSeconds ?? null } : item,
      ),
    }))
    try {
      await updateChatSettings(chatId, { autoDeleteSeconds })
    } catch (error) {
      showToast(error.message || 'Could not update auto-delete setting.')
    }
  }

  function toggleMessageSelection(messageId) {
    setSelectedMessageIds((current) => {
      const next = new Set(current)
      if (next.has(messageId)) next.delete(messageId)
      else next.add(messageId)
      return next
    })
  }

  function clearMessageSelection() {
    setSelectedMessageIds(new Set())
  }

  async function deleteSelectedMessages() {
    if (!selectedChat || !selectedMessageIds.size) return
    const ids = [...selectedMessageIds]
    clearMessageSelection()
    for (const messageId of ids) {
      await deleteMessage(messageId)
    }
  }

  async function forwardSelectedMessages(targetChatId) {
    if (!selectedChat || !selectedMessageIds.size) return
    const msgs = (state.messages[selectedChat.id] || []).filter((m) => selectedMessageIds.has(m.id))
    clearMessageSelection()
    for (const msg of msgs) {
      await forwardMessageToChat(msg, targetChatId)
    }
  }

  // Offline queue: re-send every failed text message in every backend chat.
  // Triggered when the network returns or the WebSocket reconnects.
  async function resendFailedMessages() {
    const current = stateRef.current
    if (!current) return
    for (const [chatId, chatMessages] of Object.entries(current.messages || {})) {
      const chat = current.chats.find((item) => item.id === chatId)
      if (!chat?.backend) continue
      for (const message of chatMessages) {
        if (message.status !== 'failed' || message.media || typeof message.text !== 'string') continue
        try {
          const payloadText = await encryptTextForChat(message.text, chat)
          const { message: serverMessage } = await sendChatMessage(chatId, {
            text: payloadText,
            searchText: message.text,
            replyToId: message.replyToId,
          })
          const normalized = await normalizeServerMessage(serverMessage, current.user.id)
          setState((prev) => ({
            ...prev,
            messages: {
              ...prev.messages,
              [chatId]: (prev.messages[chatId] || []).map((item) =>
                item.id === message.id ? normalized : item,
              ),
            },
          }))
        } catch {
          // Still offline or rejected — keep it queued for the next attempt.
        }
      }
    }
  }

  const resendFailedRef = useRef(resendFailedMessages)
  useEffect(() => {
    resendFailedRef.current = resendFailedMessages
  })

  // Retry timers: messageId -> { attempts, timerId }
  const retryTimersRef = useRef({})

  function scheduleRetry(messageId, chatId) {
    const existing = retryTimersRef.current[messageId]
    const attempts = existing ? existing.attempts : 0
    if (attempts >= 3) return // give up after 3 auto-retries
    const delay = [5000, 15000, 45000][attempts]
    const timerId = window.setTimeout(async () => {
      delete retryTimersRef.current[messageId]
      const current = stateRef.current
      const chat = current?.chats.find((c) => c.id === chatId)
      const message = (current?.messages[chatId] || []).find((m) => m.id === messageId)
      if (!chat?.backend || !message || message.status !== 'failed') return
      try {
        const payloadText = await encryptTextForChat(message.text, chat)
        const { message: serverMessage } = await sendChatMessage(chatId, {
          text: payloadText,
          searchText: message.text,
          replyToId: message.replyToId,
          topicId: message.topicId || undefined,
        })
        const normalized = await normalizeServerMessage(serverMessage, current.user.id)
        setState((prev) => ({
          ...prev,
          messages: {
            ...prev.messages,
            [chatId]: (prev.messages[chatId] || []).map((m) => m.id === messageId ? normalized : m),
          },
        }))
      } catch {
        // schedule next retry with increased backoff
        retryTimersRef.current[messageId] = { attempts: attempts + 1 }
        scheduleRetry(messageId, chatId)
      }
    }, delay)
    retryTimersRef.current[messageId] = { attempts: attempts + 1, timerId }
  }

  useEffect(() => {
    function handleOnline() {
      resendFailedRef.current()
    }
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [])

  async function votePollOption(messageId, optionIds) {
    if (!selectedChat?.backend) return
    try {
      const { poll } = await votePoll(selectedChat.id, messageId, optionIds)
      if (!poll) return
      setState((current) => ({
        ...current,
        messages: {
          ...current.messages,
          [selectedChat.id]: (current.messages[selectedChat.id] || []).map((message) =>
            message.id === messageId ? { ...message, poll } : message,
          ),
        },
      }))
    } catch (error) {
      showToast(error.message || 'Could not register vote.')
    }
  }

  async function scheduleSendMessage(text, linkPreview, scheduledAt, topicId) {
    if (!selectedChat?.backend) return
    try {
      const payloadText = await encryptTextForChat(text, selectedChat)
      await sendChatMessage(selectedChat.id, {
        text: payloadText,
        searchText: text,
        linkPreview: linkPreview || undefined,
        scheduledAt,
        topicId: topicId || undefined,
      })
      showToast(`Message scheduled for ${new Date(scheduledAt).toLocaleString()}`)
    } catch (error) {
      showToast(error.message || 'Could not schedule message.')
    }
  }

  async function retryMessage(messageId) {
    if (!selectedChat) return
    const message = (state.messages[selectedChat.id] || []).find((m) => m.id === messageId)
    if (!message || message.status !== 'failed') return

    // Mark as sending again
    setState((current) => ({
      ...current,
      messages: {
        ...current.messages,
        [selectedChat.id]: (current.messages[selectedChat.id] || []).map((m) =>
          m.id === messageId ? { ...m, status: 'sending' } : m,
        ),
      },
    }))

    try {
      const payloadText = await encryptTextForChat(message.text || '', selectedChat)
      const { message: serverMessage } = await sendChatMessage(selectedChat.id, {
        text: payloadText,
        searchText: message.text || '',
        replyToId: message.replyToId,
      })
      const normalized = await normalizeServerMessage(serverMessage, state.user.id)
      setState((current) => ({
        ...current,
        messages: {
          ...current.messages,
          [selectedChat.id]: (current.messages[selectedChat.id] || []).map((m) =>
            m.id === messageId ? normalized : m,
          ),
        },
      }))
    } catch (error) {
      setState((current) => ({
        ...current,
        messages: {
          ...current.messages,
          [selectedChat.id]: (current.messages[selectedChat.id] || []).map((m) =>
            m.id === messageId ? { ...m, status: 'failed' } : m,
          ),
        },
      }))
      showToast(error.message || 'Retry failed.')
    }
  }

  async function loadGroupMembers(chatId) {
    try {
      const { members } = await getChatMembers(chatId)
      return members
    } catch {
      return []
    }
  }

  function patchChatMember(chatId, userId, patch) {
    setState((current) => ({
      ...current,
      chats: current.chats.map((chat) =>
        chat.id === chatId
          ? {
              ...chat,
              members: (chat.members || []).map((member) =>
                member.id === userId ? { ...member, ...patch } : member,
              ),
            }
          : chat,
      ),
    }))
  }

  async function loadCallHistory(chatId) {
    try {
      const { calls } = await getCallHistory(chatId)
      return calls
    } catch {
      return []
    }
  }

  async function addGroupMember(chatId, userId) {
    try {
      const { member } = await addChatMember(chatId, userId)
      // Refresh server workspace to update member lists
      await loadServerWorkspace(state.user.id)
      showToast('Member added.')
      return member
    } catch (error) {
      showToast(error.message || 'Could not add member.')
      throw error
    }
  }

  async function removeGroupMember(chatId, userId) {
    try {
      await removeChatMember(chatId, userId)
      await loadServerWorkspace(state.user.id)
      showToast('Member removed.')
    } catch (error) {
      showToast(error.message || 'Could not remove member.')
      throw error
    }
  }

  async function updateGroupMemberRole(chatId, userId, input) {
    try {
      const payload = await updateChatMemberRole(chatId, userId, input)
      patchChatMember(chatId, userId, {
        role: payload.role,
        permissions: payload.permissions || {},
      })
      showToast('Member role updated.')
      return payload
    } catch (error) {
      showToast(error.message || 'Could not update member role.')
      throw error
    }
  }

  async function updateGroupMemberPermissions(chatId, userId, permissions) {
    try {
      const payload = await updateChatMemberPermissions(chatId, userId, permissions)
      patchChatMember(chatId, userId, {
        permissions: payload.permissions || {},
      })
      showToast('Member permissions updated.')
      return payload
    } catch (error) {
      showToast(error.message || 'Could not update member permissions.')
      throw error
    }
  }

  async function updateGroupInfo(chatId, { title }) {
    try {
      const { chat } = await updateChatInfo(chatId, { title })
      setState((current) => ({
        ...current,
        contacts: current.contacts.map((c) =>
          c.id === `entity-${chatId}` ? { ...c, name: chat.title } : c,
        ),
      }))
      showToast('Group updated.')
    } catch (error) {
      showToast(error.message || 'Could not update group.')
      throw error
    }
  }

  function upsertChatFolder(folder) {
    setState((current) => {
      const normalized = normalizeChatFolders({ ...current.chatFolders, folders: [folder] }).folders[0]
      return {
        ...current,
        chatFolders: {
          ...(current.chatFolders || EMPTY_CHAT_FOLDERS),
          folders: (current.chatFolders?.folders || []).some((item) => item.id === normalized.id)
            ? current.chatFolders.folders.map((item) => (item.id === normalized.id ? normalized : item))
            : [...(current.chatFolders?.folders || []), normalized],
        },
      }
    })
  }

  async function createFolder(input) {
    const { folder } = await createChatFolder(input)
    upsertChatFolder(folder)
    showToast('Folder created.')
    return folder
  }

  async function saveFolder(folderId, input) {
    const snapshot = state.chatFolders
    try {
      const { folder } = await updateChatFolder(folderId, input)
      setState((current) => {
        const existing = current.chatFolders?.folders?.find((item) => item.id === folderId)
        const nextFolder = {
          ...existing,
          ...folder,
          chats: folder.chats || existing?.chats || [],
        }
        return {
          ...current,
          chatFolders: {
            ...(current.chatFolders || EMPTY_CHAT_FOLDERS),
            folders: (current.chatFolders?.folders || []).map((item) =>
              item.id === folderId ? normalizeChatFolders({ folders: [nextFolder] }).folders[0] : item,
            ),
          },
        }
      })
      showToast('Folder saved.')
      return folder
    } catch (error) {
      setState((current) => ({ ...current, chatFolders: snapshot }))
      throw error
    }
  }

  async function removeFolder(folderId) {
    const snapshot = state.chatFolders
    setState((current) => ({
      ...current,
      chatFolders: {
        ...(current.chatFolders || EMPTY_CHAT_FOLDERS),
        folders: (current.chatFolders?.folders || []).filter((folder) => folder.id !== folderId),
      },
    }))
    if (selectedFolderId === folderId) setSelectedFolderId('all')
    try {
      await deleteChatFolder(folderId)
      showToast('Folder deleted.')
    } catch (error) {
      setState((current) => ({ ...current, chatFolders: snapshot }))
      throw error
    }
  }

  async function toggleFolderChatPin(folderId, chatId) {
    const folder = state.chatFolders?.folders?.find((item) => item.id === folderId)
    const folderChat = folder?.chats?.find((item) => item.chatId === chatId)
    if (!folder || !folderChat) return
    const nextPinned = !folderChat.pinned
    const now = new Date().toISOString()
    const snapshot = state.chatFolders
    setState((current) => ({
      ...current,
      chatFolders: {
        ...(current.chatFolders || EMPTY_CHAT_FOLDERS),
        folders: (current.chatFolders?.folders || []).map((item) =>
          item.id === folderId
            ? {
                ...item,
                chats: item.chats.map((chat) =>
                  chat.chatId === chatId
                    ? { ...chat, pinned: nextPinned, pinnedAt: nextPinned ? now : null }
                    : chat,
                ),
              }
            : item,
        ),
      },
    }))
    try {
      const { chat } = await updateChatFolderChat(folderId, chatId, { pinned: nextPinned })
      setState((current) => ({
        ...current,
        chatFolders: {
          ...(current.chatFolders || EMPTY_CHAT_FOLDERS),
          folders: (current.chatFolders?.folders || []).map((item) =>
            item.id === folderId
              ? {
                  ...item,
                  chats: item.chats.map((folderChat) =>
                    folderChat.chatId === chatId ? { ...folderChat, ...chat } : folderChat,
                  ),
                }
              : item,
          ),
        },
      }))
    } catch (error) {
      setState((current) => ({ ...current, chatFolders: snapshot }))
      showToast(error.message || 'Folder pin was not saved.')
    }
  }

  async function createChat(contactId) {
    const existing = state.chats.find((chat) => chat.contactId === contactId)
    if (existing) {
      selectChat(existing.id)
      setUi((current) => ({ ...current, contactsOpen: false }))
      return
    }

    const contact = state.contacts.find((item) => item.id === contactId)
    if (contact?.backend) {
      try {
        const { chat } = await createServerChat({
          type: 'private',
          title: '',
          memberIds: [contactId],
        })
        const chatSettings = chat.settings || {}
        const serverChat = {
          id: chat.id,
          contactId,
          backend: true,
          serverType: 'private',
          members: [
            { id: state.user.id, encryptionPublicKey: state.user.encryptionPublicKey },
            {
              id: contactId,
              encryptionPublicKey: contact.encryptionPublicKey,
              blockedByMe: Boolean(contact.blockedByMe),
              blockedMe: Boolean(contact.blockedMe),
            },
          ],
          pinned: Boolean(chatSettings.pinned),
          pinnedAt: chatSettings.pinnedAt || null,
          muted: Boolean(chatSettings.muted),
          mutedUntil: chatSettings.mutedUntil || null,
          archived: Boolean(chatSettings.archived),
          archivedAt: chatSettings.archivedAt || null,
          pushMode: chatSettings.pushMode || 'default',
          autoDeleteSeconds: chatSettings.autoDeleteSeconds ?? null,
          unread: 0,
          createdAt: new Date().toISOString(),
        }
        setState((current) => ({
          ...current,
          chats: current.chats.some((item) => item.id === chat.id)
            ? current.chats
            : [serverChat, ...current.chats],
          messages: {
            ...current.messages,
            [chat.id]: current.messages[chat.id] || [],
          },
        }))
        setSelectedChatId(chat.id)
        setUi((current) => ({
          ...current,
          contactsOpen: false,
          menuOpen: false,
          mobilePane: 'chat',
        }))
        await loadMessagesFromServer(chat.id)
      } catch (error) {
        showToast(error.message || 'Could not create chat.')
      }
      return
    }

    const id = createId('chat')
    setState((current) => ({
      ...current,
      chats: [
        {
          id,
          contactId,
          pinned: false,
          muted: false,
          archived: false,
          unread: 0,
          createdAt: new Date().toISOString(),
        },
        ...current.chats,
      ],
      messages: {
        ...current.messages,
        [id]: [],
      },
    }))
    setSelectedChatId(id)
    setUi((current) => ({ ...current, contactsOpen: false, mobilePane: 'chat' }))
  }

  async function sendAttachment(file, caption, options = {}) {
    if (!selectedChat) return
    const rich = options.album
      ? {
          type: 'album',
          caption,
          albumId: options.album.albumId,
          index: options.album.index,
          count: options.album.count,
        }
      : null
    const messageText = rich ? encodeRichMessage(rich) : caption

    if (!selectedChat.backend) {
      const mediaUrl = URL.createObjectURL(file)
      const localKind = file.type.startsWith('image/')
        ? 'image'
        : file.type.startsWith('video/')
          ? /^video-note-\d+\.(webm|mp4)$/i.test(file.name)
            ? 'video_note'
            : 'video'
          : file.type.startsWith('audio/')
            ? /^voice-\d+\.(webm|ogg|m4a)$/i.test(file.name)
              ? 'voice'
              : 'audio'
            : 'file'
      setState((current) => ({
        ...current,
        messages: {
          ...current.messages,
          [selectedChat.id]: [
            ...(current.messages[selectedChat.id] || []),
            {
              id: createId('media'),
              senderId: current.user.id,
              text: caption,
              rich,
              albumId: rich?.albumId,
              albumIndex: rich?.index,
              albumCount: rich?.count,
              time: new Date().toISOString(),
              status: 'read',
              reactions: {},
              media: {
                id: createId('local-media'),
                kind: localKind,
                name: file.name,
                mimeType: file.type,
                size: file.size,
                originalSize: file.size,
                url: mediaUrl,
              },
            },
          ],
        },
      }))
      showToast('Media added locally. Server compression is used in registered-user chats.')
      return
    }

    if (!options.quiet) showToast('Preparing encrypted media...')
    try {
      const encryptedCaption = await encryptTextForChat(messageText, selectedChat)
      const encryptedMedia = await encryptMediaForChat(file, selectedChat)
      const { media } = await uploadMedia(encryptedMedia.file, selectedChat.id, {
        ...encryptedMedia.metadata,
        signal: options.signal,
        onUploadProgress: options.onUploadProgress,
      })
      const { message } = await sendChatMessage(selectedChat.id, {
        text: encryptedCaption,
        searchText: rich ? getRichSearchText(rich) : caption,
        mediaId: media.id,
      })
      const normalizedMessage = await normalizeServerMessage(message, state.user.id)
      if (pendingReadIdsRef.current.has(normalizedMessage.id)) {
        normalizedMessage.status = 'read'
        pendingReadIdsRef.current.delete(normalizedMessage.id)
      }
      setState((current) => ({
        ...current,
        messages: {
          ...current.messages,
          [selectedChat.id]: (current.messages[selectedChat.id] || []).some(
            (item) => item.id === normalizedMessage.id,
          )
            ? current.messages[selectedChat.id]
            : [...(current.messages[selectedChat.id] || []), normalizedMessage],
        },
      }))
      const savedPercent = media.originalSize
        ? Math.max(0, Math.round((1 - media.size / media.originalSize) * 100))
        : 0
      if (options.quiet) {
        return
      }
      if (savedPercent) {
        showToast(`Media sent. Compressed by ${savedPercent}%.`)
      } else if (encryptedMedia.metadata.kind === 'video' && !encryptedMedia.compressed) {
        showToast('Video sent encrypted. Browser compression was not available.')
      } else {
        showToast('Media sent.')
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        showToast('Media upload cancelled.')
      } else {
        showToast(error.message || 'Media upload failed.')
      }
      throw error
    }
  }

  async function sendAttachments(files, caption, options = {}) {
    const list = Array.from(files || []).filter(Boolean)
    if (!list.length) return
    if (list.length === 1) {
      await sendAttachment(list[0], caption, options)
      return
    }

    const albumId = createId('album')
    const progress = new Array(list.length).fill(0)
    for (let index = 0; index < list.length; index += 1) {
      await sendAttachment(list[index], index === 0 ? caption : '', {
        ...options,
        quiet: true,
        album: { albumId, index: index + 1, count: list.length },
        onUploadProgress: (percent) => {
          progress[index] = percent
          const aggregate = Math.round(progress.reduce((sum, value) => sum + value, 0) / list.length)
          options.onUploadProgress?.(aggregate)
        },
      })
    }
    showToast(`Album sent: ${list.length} items.`)
  }

  async function createSpace({ type, name }) {
    try {
      const { chat } = await createServerChat({ type, title: name, memberIds: [] })
      await loadServerWorkspace(state.user.id)
      setUi((current) => ({ ...current, createSpace: '', menuOpen: false, mobilePane: 'chat' }))
      selectChat(chat.id)
      showToast(type === 'group' ? t('toast.groupCreated') : t('toast.channelCreated'))
    } catch (error) {
      showToast(error.message || t('toast.spaceFailed'))
    }
  }

  function updateSettings(patch) {
    if (patch.toast) {
      showToast(patch.toast)
      return
    }
    setState((current) => ({
      ...current,
      settings: { ...current.settings, ...patch },
    }))
  }

  function normalizeProfilePatch(user) {
    return {
      name: String(user.name || '').trim().slice(0, 64) || 'Onda User',
      username: String(user.username || '')
        .replace(/^@+/, '')
        .trim()
        .toLowerCase()
        .slice(0, 32),
      bio: String(user.bio || '').trim().slice(0, 240),
      status: String(user.customStatus || '').trim().slice(0, 80),
    }
  }

  function applyServerUser(user) {
    const appUser = {
      ...state.user,
      id: user.id,
      login: user.login,
      name: user.name,
      username: `@${user.username}`,
      bio: user.bio || '',
      customStatus: user.status || '',
      avatar: user.avatar,
      encryptionPublicKey: user.encryptionPublicKey || state.user.encryptionPublicKey,
      totpEnabled: Boolean(user.totpEnabled),
    }
    setState((current) => ({ ...current, user: appUser }))
    setAuth((current) => ({
      ...current,
      user: current.user ? { ...current.user, ...appUser } : current.user,
    }))
  }

  function updateUserProfile(patch) {
    const nextUser = { ...state.user, ...patch }
    setState((current) => ({ ...current, user: { ...current.user, ...patch } }))
    window.clearTimeout(profileSaveTimerRef.current)
    profileSaveTimerRef.current = window.setTimeout(async () => {
      try {
        const input = normalizeProfilePatch(nextUser)
        if (!/^[a-zA-Z0-9_]{3,32}$/.test(input.username)) {
          showToast('Username must be 3-32 letters, numbers or underscores.')
          return
        }
        const { user } = await updateProfile(input)
        applyServerUser(user)
        showToast('Profile saved.')
      } catch (error) {
        showToast(error.message || 'Profile was not saved.')
      }
    }, 650)
  }

  async function exportEncryptionKey() {
    try {
      const backup = await exportUserKeyBackup(state.user.id)
      const url = URL.createObjectURL(new Blob([backup], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `astrachat-${state.user.login || state.user.id}.astrakey`
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      showToast('Encryption key exported.')
    } catch (error) {
      showToast(error.message || 'Encryption key was not exported.')
    }
  }

  async function importEncryptionKey(file) {
    try {
      const keyRecord = await importUserKeyBackup(state.user.id, await file.text())
      const { user } = await updateEncryptionPublicKey(keyRecord.publicKey)
      const encryptionPublicKey = user.encryptionPublicKey || keyRecord.publicKey
      const updatedUser = {
        ...state.user,
        encryptionPublicKey,
      }
      setState((current) => ({
        ...current,
        user: updatedUser,
        contacts: current.contacts.map((contact) =>
          contact.id === current.user.id ? { ...contact, encryptionPublicKey } : contact,
        ),
        chats: current.chats.map((chat) => ({
          ...chat,
          members: chat.members?.map((member) =>
            member.id === current.user.id ? { ...member, encryptionPublicKey } : member,
          ),
        })),
      }))
      setAuth((current) => ({
        ...current,
        user: current.user ? { ...current.user, encryptionPublicKey } : current.user,
      }))
      await loadServerWorkspace(state.user.id, encryptionPublicKey)
      showToast('Encryption key imported.')
    } catch (error) {
      showToast(error.message || 'Encryption key was not imported.')
    }
  }

  // Cloud key backup: passphrase-encrypted blob synced via the server so a
  // second device can pick up the local encryption key without manual file transfer.
  async function cloudKeyBackup(passphrase) {
    try {
      const backup = await exportUserKeyBackup(state.user.id)
      const payload = await encryptKeyBackupWithPassphrase(backup, passphrase)
      await putCloudKeyBackup(payload)
      showToast(t('cloudKey.saved'))
      return true
    } catch (error) {
      showToast(error.message || t('cloudKey.saveFailed'))
      return false
    }
  }

  async function cloudKeyRestore(passphrase) {
    try {
      const { payload } = await getCloudKeyBackup()
      const backup = await decryptKeyBackupWithPassphrase(payload, passphrase)
      await importEncryptionKey(new Blob([backup], { type: 'application/json' }))
      return true
    } catch (error) {
      showToast(error.message || t('cloudKey.restoreFailed'))
      return false
    }
  }

  async function loadSessions() {
    const { sessions } = await getSessions()
    return sessions
  }

  async function loadTotpStatus() {
    return getTotpStatus()
  }

  async function beginTotpSetup() {
    return startTotpSetup()
  }

  async function confirmTotpSetup(code) {
    const { user } = await verifyTotpSetup(code)
    applyServerUser(user)
    showToast('Two-factor authentication enabled.')
    return user
  }

  async function turnOffTotp(code) {
    const { user } = await disableTotp(code)
    applyServerUser(user)
    showToast('Two-factor authentication disabled.')
    return user
  }

  async function loadSecurityAlerts(unread = false) {
    const { events } = await getSecurityEvents({ unread })
    return events
  }

  async function markSecurityAlertRead(eventId) {
    await markSecurityEventRead(eventId)
  }

  async function markAllSecurityAlertsRead() {
    await markAllSecurityEventsRead()
    showToast('Security alerts marked as read.')
  }

  async function loadBlockedContacts() {
    const { users } = await getBlockedUsers()
    return users
  }

  async function loadPrivacySettings() {
    return getPrivacySettings()
  }

  async function savePrivacySettings(updates) {
    return updatePrivacySettings(updates)
  }

  function applyBlockedState(userId, blockedByMe) {
    setState((current) => ({
      ...current,
      contacts: current.contacts.map((contact) =>
        contact.id === userId ? { ...contact, blockedByMe } : contact,
      ),
      chats: current.chats.map((chat) => ({
        ...chat,
        members: chat.members?.map((member) =>
          member.id === userId ? { ...member, blockedByMe } : member,
        ),
      })),
    }))
  }

  async function saveContact(userId) {
    if (!userId || userId === state.user.id) return
    const previous = state.contacts
    setState((current) => ({
      ...current,
      contacts: current.contacts.map((contact) =>
        contact.id === userId
          ? { ...contact, isContact: true, contactSince: contact.contactSince || new Date().toISOString() }
          : contact,
      ),
    }))
    try {
      const { contact } = await addContact(userId)
      setState((current) => ({
        ...current,
        contacts: current.contacts.some((item) => item.id === contact.id)
          ? current.contacts.map((item) =>
              item.id === contact.id
                ? { ...item, isContact: true, contactSince: contact.contactSince || item.contactSince }
                : item,
            )
          : [
              ...current.contacts,
              {
                id: contact.id,
                type: 'private',
                backend: true,
                name: contact.name,
                username: `@${contact.username}`,
                customStatus: contact.status || '',
                avatar: contact.avatar,
                color: '#3390ec',
                status: contact.online ? 'online' : 'offline',
                lastSeen: contact.online ? t('status.online') : formatLastSeen(contact.lastSeenAt),
                lastSeenAt: contact.lastSeenAt,
                encryptionPublicKey: contact.encryptionPublicKey,
                blockedByMe: Boolean(contact.blockedByMe),
                blockedMe: Boolean(contact.blockedMe),
                isContact: true,
                contactSince: contact.contactSince || new Date().toISOString(),
                phone: '',
                bio: contact.bio || 'Onda user',
              },
            ],
      }))
      showToast('Contact added.')
    } catch (error) {
      setState((current) => ({ ...current, contacts: previous }))
      showToast(error.message || 'Contact was not added.')
    }
  }

  async function forgetContact(userId) {
    if (!userId || userId === state.user.id) return
    const previous = state.contacts
    setState((current) => ({
      ...current,
      contacts: current.contacts.map((contact) =>
        contact.id === userId ? { ...contact, isContact: false, contactSince: null } : contact,
      ),
    }))
    try {
      await removeContact(userId)
      showToast('Contact removed.')
    } catch (error) {
      setState((current) => ({ ...current, contacts: previous }))
      showToast(error.message || 'Contact was not removed.')
    }
  }

  async function blockContact(userId) {
    if (!userId) return
    const sure = await confirm('Block this user? They will not be able to direct-message or call you.')
    if (!sure) return
    await blockUser(userId)
    applyBlockedState(userId, true)
    showToast('User blocked.')
  }

  async function unblockContact(userId) {
    if (!userId) return
    await unblockUser(userId)
    applyBlockedState(userId, false)
    showToast('User unblocked.')
  }

  async function reportUser(userId, context = {}) {
    if (!userId) return
    const details = window.prompt('Report details', context.details || '')
    if (details === null) return
    await reportAbuse({
      targetUserId: userId,
      chatId: context.chatId || selectedChatId || undefined,
      reason: context.reason || 'abuse',
      details,
    })
    showToast('Report sent.')
  }

  async function reportMessage(message) {
    if (!message?.id) return
    const details = window.prompt('Report this message', '')
    if (details === null) return
    await reportAbuse({
      targetMessageId: message.id,
      targetUserId: message.senderId,
      chatId: selectedChatId || undefined,
      reason: 'spam',
      details,
    })
    showToast('Message reported.')
  }

  async function endSession(sessionId) {
    const currentSessions = await loadSessions()
    const target = currentSessions.find((session) => session.id === sessionId)
    await terminateSession(sessionId)
    if (target?.current) {
      setAuth({ status: 'anonymous', user: null, error: '' })
      setSelectedFolderId('all')
      setUi((current) => ({ ...current, menuOpen: false, mobilePane: 'list' }))
    } else {
      showToast('Session terminated.')
    }
  }

  async function endOtherSessions() {
    await terminateOtherSessions()
    showToast('Other sessions terminated.')
  }

  function resetState() {
    resetMessengerState()
    setState(fallbackState)
    setSelectedChatId(fallbackState.chats[0].id)
    setSelectedFolderId('all')
    setUi((current) => ({ ...current, menuOpen: false, createSpace: '', mobilePane: 'list' }))
    showToast('Local data reset.')
  }

  if (auth.status === 'loading') {
    return (
      <main className="auth-screen">
        <div className="auth-loading">
          <div className="auth-loading-mark">A</div>
          <span>Connecting...</span>
        </div>
      </main>
    )
  }

  if (auth.status !== 'authenticated') {
    return (
      <AuthScreen
        pending={auth.status === 'pending'}
        error={auth.error}
        totpRequired={auth.status === 'totp'}
        cloudPasswordRequired={auth.status === 'cloudPassword'}
        cloudPasswordHint={auth.cloudChallenge?.hint}
        onLogin={handleLogin}
        onTotpLogin={handleTotpLogin}
        onCloudPasswordLogin={handleCloudPasswordLogin}
        onCancelTotp={cancelTotpLogin}
        onRegister={handleRegister}
        onPhoneStart={handlePhoneStart}
        onPhoneVerify={handlePhoneVerify}
        onQrSuccess={completeAuthentication}
        prefillLogin={prefillLogin}
      />
    )
  }

  async function handleSendWallMessage(text) {
    try {
      await sendWallMessage(text)
      showToast(t('toast.wallSent'))
      return true
    } catch (error) {
      showToast(error.message || t('toast.wallFailed'))
      return false
    }
  }

  async function handleStoryReplySent(result) {
    if (!result?.chatId) return
    await loadServerWorkspace(state.user.id)
    setSelectedChatId(result.chatId)
    setUi((current) => ({
      ...current,
      mobilePane: 'chat',
      contactsOpen: false,
      menuOpen: false,
    }))
  }

  return (
    <>
    <Suspense fallback={(
      <main className="auth-screen">
        <div className="auth-loading">
          <div className="auth-loading-mark">A</div>
          <span>Loading chats...</span>
        </div>
      </main>
    )}>
    <AppShell
      chatSummaries={chatSummaries}
      chatFolders={state.chatFolders || EMPTY_CHAT_FOLDERS}
      selectedFolderId={selectedFolderId}
      contacts={state.contacts}
      user={state.user}
      settings={state.settings}
      wordStreamWords={wordStreamWords}
      allMessages={state.messages}
      wallMessages={wallMessages}
      liveWallChatWords={liveWallChatWords}
      onSendWallMessage={handleSendWallMessage}
      selectedChat={selectedChat}
      selectedContact={selectedContact}
      messages={messages}
      messageSearch={messageSearch}
      sidebarSearch={sidebarSearch}
      ui={ui}
      replyTo={replyTo}
      editingMessage={editingMessage}
      selectedMessageId={selectedMessageId}
      toast={toast}
      callController={callController}
      typingUsers={selectedTypingUsers}
      onSelectChat={selectChat}
      onSelectFolder={setSelectedFolderId}
      onSidebarSearch={setSidebarSearch}
      onMessageSearch={setMessageSearch}
      onSendMessage={sendMessage}
      onSendAttachment={sendAttachment}
      onSendAttachments={sendAttachments}
      onSendRichMessage={sendRichMessage}
      onTyping={handleTyping}
      onStartReply={startReply}
      onStartEdit={startEdit}
      onCancelReply={() => setReplyToId('')}
      onCancelEdit={() => setEditingMessageId('')}
      onDeleteMessage={deleteMessage}
      onCopyMessage={copyMessage}
      onReact={reactToMessage}
      forwardSource={forwardSource}
      onClearForwardCompose={clearForwardCompose}
      onForwardCompose={startForwardCompose}
      onForwardMessage={forwardMessageToChat}
      onSelectMessage={(id) => setSelectedMessageId((current) => (current === id ? '' : id))}
      onJumpToMessage={jumpToMessage}
      hasMoreMessages={hasMoreMessages[selectedChatId] || false}
      unreadFromId={unreadFromId[selectedChatId] || null}
      selectedMessageIds={selectedMessageIds}
      onLoadMoreMessages={loadMoreMessages}
      onToggleMessageSelection={toggleMessageSelection}
      onClearMessageSelection={clearMessageSelection}
      onDeleteSelectedMessages={deleteSelectedMessages}
      onForwardSelectedMessages={forwardSelectedMessages}
      onPinMessage={pinMessage}
      onRetryMessage={retryMessage}
      onVotePoll={votePollOption}
      onScheduleSend={scheduleSendMessage}
      onStoryReplySent={handleStoryReplySent}
      onLoadGroupMembers={loadGroupMembers}
      onLoadCallHistory={loadCallHistory}
      onAddGroupMember={addGroupMember}
      onRemoveGroupMember={removeGroupMember}
      onUpdateGroupInfo={updateGroupInfo}
      onUpdateGroupMemberRole={updateGroupMemberRole}
      onUpdateGroupMemberPermissions={updateGroupMemberPermissions}
      onTogglePin={(chatId) => toggleChatField(chatId, 'pinned')}
      onMuteChat={muteChat}
      onToggleMute={(chatId) => toggleChatField(chatId, 'muted')}
      onSetChatPushMode={setChatPushMode}
      onSetChatAutoDelete={setChatAutoDelete}
      onArchiveChat={archiveChat}
      onCreateFolder={createFolder}
      onUpdateFolder={saveFolder}
      onDeleteFolder={removeFolder}
      onToggleFolderPin={toggleFolderChatPin}
      onExportEncryptionKey={exportEncryptionKey}
      onCloudKeyBackup={cloudKeyBackup}
      onCloudKeyRestore={cloudKeyRestore}
      onImportEncryptionKey={importEncryptionKey}
      onUploadAvatar={uploadUserAvatar}
      onRemoveAvatar={removeUserAvatar}
      onChangePassword={changeUserPassword}
      onDeleteAccount={removeAccount}
      onLoadSessions={loadSessions}
      onLoadTotpStatus={loadTotpStatus}
      onStartTotpSetup={beginTotpSetup}
      onVerifyTotpSetup={confirmTotpSetup}
      onDisableTotp={turnOffTotp}
      onLoadCloudPasswordStatus={getCloudPasswordStatus}
      onSetCloudPassword={setCloudPassword}
      onRemoveCloudPassword={removeCloudPassword}
      onTerminateOtherSessions={endOtherSessions}
      onTerminateSession={endSession}
      onLoadSecurityAlerts={loadSecurityAlerts}
      onMarkSecurityAlertRead={markSecurityAlertRead}
      onMarkAllSecurityAlertsRead={markAllSecurityAlertsRead}
      onLoadBlockedContacts={loadBlockedContacts}
      onAddContact={saveContact}
      onRemoveContact={forgetContact}
      onBlockUser={blockContact}
      onUnblockUser={unblockContact}
      onReportUser={reportUser}
      onReportMessage={reportMessage}
      onCreateChat={createChat}
      onCreateSpace={createSpace}
      onOpenContacts={() => setUi((current) => ({ ...current, contactsOpen: true, menuOpen: false }))}
      onCloseContacts={() => setUi((current) => ({ ...current, contactsOpen: false }))}
      onOpenCreateSpace={(mode) => setUi((current) => ({ ...current, createSpace: mode, menuOpen: false }))}
      onCloseCreateSpace={() => setUi((current) => ({ ...current, createSpace: '' }))}
      onUpdateSettings={updateSettings}
      onUpdateUser={updateUserProfile}
      onOpenProfile={() => setUi((current) => ({ ...current, profileOpen: true }))}
      onCloseProfile={() => setUi((current) => ({ ...current, profileOpen: false }))}
      onToggleSearch={() => setUi((current) => ({ ...current, searchOpen: !current.searchOpen }))}
      onToggleMenu={() => setUi((current) => ({ ...current, menuOpen: !current.menuOpen }))}
      onOpenCall={(kind) => {
        const chatType = selectedChat?.serverType || selectedContact?.type
        if (!selectedChat?.backend || !selectedContact?.backend || !['private', 'group'].includes(chatType)) {
          showToast('Calls are available in registered-user private chats and groups.')
          return
        }
        callController.startCall({
          contact: selectedContact,
          chat: selectedChat,
          chatId: selectedChat.id,
          kind,
        })
      }}
      onResetState={resetState}
      onLogout={handleLogout}
      onSwitchAccount={handleSwitchAccount}
      onAddAccount={handleAddAccount}
      onRemoveAccount={handleRemoveAccount}
      onLoadPrivacy={loadPrivacySettings}
      onUpdatePrivacy={savePrivacySettings}
      onBackToList={() => setUi((current) => ({ ...current, mobilePane: 'list' }))}
      onGlobalSearchSelectChat={(result) => {
        const chat = state.chats?.find((c) => c.id === result.id)
          || state.contacts?.find((c) => c.id === result.id)
        if (chat) selectChat(chat.id)
      }}
      onGlobalSearchJumpMessage={(chatId, messageId) => {
        selectChat(chatId)
        window.setTimeout(() => jumpToMessage(messageId), 200)
      }}
    />
    </Suspense>
    {permissionPromptOpen && (
      <PermissionOnboarding onClose={() => setPermissionPromptOpen(false)} />
    )}
    {confirmDialog}
    </>
  )
}

export default function App() {
  const globalAudio = useGlobalAudioProvider()
  return (
    <GlobalAudioContext.Provider value={globalAudio}>
      <AppInner />
    </GlobalAudioContext.Provider>
  )
}
