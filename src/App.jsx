import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AppShell from './components/AppShell'
import AuthScreen from './components/AuthScreen'
import useWebRTCCall from './hooks/useWebRTCCall'
import { contacts as seedContacts, currentUser, initialChats, initialMessages } from './data/sampleData'
import { byPinnedThenRecent, getLastMessage } from './utils/formatters'
import { loadMessengerState, resetMessengerState, saveMessengerState } from './utils/storage'
import { bumpAvatarCache } from './utils/avatarCache'
import {
  changePassword,
  createChatFolder,
  createChat as createServerChat,
  deleteAccount,
  deleteAvatar,
  deleteChatFolder,
  deleteChatMessage,
  deleteChatMessageForMe,
  editChatMessage,
  getChatFolders,
  getSessions,
  getChatMessages,
  getChats,
  getCurrentSession,
  loginAccount,
  logoutAccount,
  registerAccount,
  testLogin,
  searchUsers,
  sendChatMessage,
  terminateOtherSessions,
  terminateSession,
  updateChatFolder,
  updateChatFolderChat,
  toggleMessageReaction,
  updateChatSettings,
  updateProfile,
  updateEncryptionPublicKey,
  uploadAvatar,
  uploadMedia,
} from './api/client'
import {
  decryptBlobForUser,
  decryptTextForUser,
  encryptBlobForRecipients,
  encryptTextForRecipients,
  ensureUserKeyPair,
  exportUserKeyBackup,
  importUserKeyBackup,
  publicKeyEquals,
} from './utils/e2ee'
import {
  DEFAULT_WORD_STREAM_SETTINGS,
  extractPrivateWordStream,
} from './utils/wordStream'
import { ensureNotificationPermission, playIncomingSound, showDesktopNotification } from './utils/notify'

const APP_TITLE = 'AstraChat'

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
    notifications: true,
    sound: true,
    chatBackground: 'default',
    wordStream: DEFAULT_WORD_STREAM_SETTINGS,
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
      file: '\u{1F4CE} File',
    }
    return labels[message.media.kind] || 'Attachment'
  }
  return 'New message'
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
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
  const decrypted = await decryptTextForUser(message.text || '', currentUserId)
  const media = await normalizeServerMedia(message.media, currentUserId)
  return {
    id: message.id,
    senderId: message.senderId,
    text: decrypted.text,
    time: message.createdAt,
    edited: Boolean(message.editedAt),
    deleted: Boolean(message.deletedAt),
    status: message.status || 'sent',
    replyToId: message.replyToId || undefined,
    forwarded: Boolean(message.forwarded),
    forwardedFromMessageId: message.forwardedFromMessageId || undefined,
    forwardedFromChatId: message.forwardedFromChatId || undefined,
    reactions: message.reactions || {},
    media,
    backend: true,
    encrypted: decrypted.encrypted,
    decryptFailed: decrypted.failed,
  }
}

async function normalizeServerMedia(media, currentUserId) {
  if (!media || !media.encrypted) return media || null

  try {
    const response = await fetch(media.url, { credentials: 'same-origin' })
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

function formatLastSeen(lastSeenAt) {
  if (!lastSeenAt) return 'last seen recently'
  const date = new Date(lastSeenAt)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return `last seen at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  }
  return `last seen ${date.toLocaleDateString([], { day: 'numeric', month: 'short' })}`
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

async function prepareClientMediaFile(file) {
  if (file.type.startsWith('audio/')) {
    return {
      blob: file,
      kind: 'voice',
      mimeType: file.type || 'audio/webm',
      width: null,
      height: null,
      durationMs: await getAudioDurationMs(file),
      originalSize: file.size,
      compressed: false,
    }
  }

  if (file.type.startsWith('video/')) {
    try {
      return await compressVideoInBrowser(file)
    } catch {
      // Keep end-to-end encryption even when browser-side video compression is unavailable.
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

export default function App() {
  const [state, setState] = useState(() => loadMessengerState(fallbackState))
  const [auth, setAuth] = useState({
    status: 'loading',
    user: null,
    error: '',
  })
  const [selectedChatId, setSelectedChatId] = useState(() => state.chats.find((chat) => !chat.archived)?.id || '')
  const [selectedFolderId, setSelectedFolderId] = useState('all')
  const [sidebarSearch, setSidebarSearch] = useState('')
  const [messageSearch, setMessageSearch] = useState('')
  const [replyToId, setReplyToId] = useState('')
  const [editingMessageId, setEditingMessageId] = useState('')
  const [selectedMessageId, setSelectedMessageId] = useState('')
  const [toast, setToast] = useState('')
  const [pendingInvite, setPendingInvite] = useState(() => {
    if (typeof window === 'undefined') return ''
    const params = new URLSearchParams(window.location.search)
    const add = params.get('add')
    if (add) {
      params.delete('add')
      const query = params.toString()
      window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
    }
    return add ? add.replace(/^@/, '').toLowerCase() : ''
  })
  const toastTimerRef = useRef()
  const selectedChatIdRef = useRef(selectedChatId)
  const socketRef = useRef(null)
  const profileSaveTimerRef = useRef(null)
  const callSignalHandlerRef = useRef(null)
  const callSocketCloseHandlerRef = useRef(null)
  const pendingReadIdsRef = useRef(new Set())
  const stateRef = useRef(state)
  const selectChatRef = useRef(null)
  const [presence, setPresence] = useState({})
  const [typingByChat, setTypingByChat] = useState({})
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

  // Sound + desktop notification for an incoming message (Telegram-style: quiet when you are reading the chat).
  const notifyIncoming = useCallback((message, chatId, senderId) => {
    const snapshot = stateRef.current
    if (!snapshot?.user || senderId === snapshot.user.id) return
    const settings = snapshot.settings || {}
    const isActiveChat = selectedChatIdRef.current === chatId && !document.hidden
    if (isActiveChat) return
    if (settings.sound) playIncomingSound()
    if (settings.notifications) {
      const sender = snapshot.contacts.find((contact) => contact.id === senderId)
      showDesktopNotification({
        title: sender?.name || 'New message',
        body: notificationBody(message),
        tag: chatId,
        onClick: () => selectChatRef.current?.(chatId),
      })
    }
  }, [])

  const callController = useWebRTCCall({ sendSignal: sendSocketEvent })

  useEffect(() => {
    callSignalHandlerRef.current = callController.handleSignal
    callSocketCloseHandlerRef.current = callController.handleSocketClose
  }, [callController.handleSignal, callController.handleSocketClose])

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

  // Request notification permission once the user is in and notifications are enabled.
  useEffect(() => {
    if (auth.status === 'authenticated' && state.settings.notifications) {
      ensureNotificationPermission()
    }
  }, [auth.status, state.settings.notifications])

  // Keep a fresh reference to the chat selector for notification click handling.
  useEffect(() => {
    selectChatRef.current = selectChat
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
    if (auth.status !== 'authenticated') return undefined

    let reconnectTimer
    let shouldReconnect = true
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws`)
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
      if (payload.type === 'session:ready') {
        const onlineIds = new Set(payload.onlineUserIds || [])
        setPresence((current) => {
          const next = { ...current }
          onlineIds.forEach((userId) => {
            next[userId] = { ...(next[userId] || {}), online: true }
          })
          return next
        })
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
          setTypingByChat((current) =>
            Object.fromEntries(
              Object.entries(current).filter(([, userId]) => userId !== payload.userId),
            ),
          )
        }
        return
      }

      if (payload.type === 'typing:update' && payload.chatId) {
        setTypingByChat((current) => {
          if (payload.active) return { ...current, [payload.chatId]: payload.userId }
          if (current[payload.chatId] !== payload.userId) return current
          const next = { ...current }
          delete next[payload.chatId]
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
                }
              : chat,
          ),
        }))
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
        readIds.forEach((messageId) => pendingReadIdsRef.current.add(messageId))
        setState((current) => ({
          ...current,
          messages: {
            ...current.messages,
            [payload.chatId]: (current.messages[payload.chatId] || []).map((message) =>
              readIds.has(message.id) ? { ...message, status: 'read' } : message,
            ),
          },
        }))
        return
      }

      if (payload.type === 'message:new' && payload.message?.chatId) {
        void normalizeServerMessage(payload.message, state.user.id).then((message) => {
          setState((current) => {
            const chatId = payload.message.chatId
            const currentMessages = current.messages[chatId] || []
            if (currentMessages.some((item) => item.id === message.id)) return current

            return {
              ...current,
              chats: current.chats.map((chat) =>
                chat.id === chatId && selectedChatIdRef.current !== chatId
                  ? { ...chat, unread: (chat.unread || 0) + 1 }
                  : chat,
              ),
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
  }, [auth.status, notifyIncoming, socketVersion, state.user.id])

  async function loadServerWorkspace(currentUserId, currentUserPublicKey = state.user.encryptionPublicKey) {
    try {
      const [{ users }, { chats }, folderPayload] = await Promise.all([
        searchUsers(),
        getChats(),
        getChatFolders(),
      ])
      const serverContacts = users
        .filter((user) => user.id !== currentUserId)
        .map((user) => ({
          id: user.id,
          type: 'private',
          backend: true,
          name: user.name,
          username: `@${user.username}`,
          avatar: user.avatar,
          color: '#3390ec',
          status: user.online ? 'online' : 'offline',
          lastSeen: user.online ? 'online' : formatLastSeen(user.lastSeenAt),
          lastSeenAt: user.lastSeenAt,
          encryptionPublicKey: user.encryptionPublicKey,
          phone: '',
          bio: user.bio || 'AstraChat user',
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
            encryptionPublicKey: member.encryptionPublicKey,
          })),
          pinned: Boolean(chatSettings.pinned),
          pinnedAt: chatSettings.pinnedAt || null,
          muted: Boolean(chatSettings.muted),
          mutedUntil: chatSettings.mutedUntil || null,
          archived: Boolean(chatSettings.archived),
          archivedAt: chatSettings.archivedAt || null,
          unread: 0,
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
      avatar: user.avatar,
      encryptionPublicKey,
    }
    setState((current) => ({ ...current, user: appUser }))
    setAuth({ status: 'authenticated', user: appUser, error: '' })
    await loadServerWorkspace(user.id, encryptionPublicKey)
  }

  async function handleLogin(input) {
    setAuth((current) => ({ ...current, status: 'pending', error: '' }))
    try {
      const { user } = await loginAccount(input)
      await completeAuthentication(user)
    } catch (error) {
      setAuth({ status: 'anonymous', user: null, error: error.message })
    }
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

  async function handleTestLogin(slot) {
    setAuth((current) => ({ ...current, status: 'pending', error: '' }))
    try {
      const { user } = await testLogin(slot)
      await completeAuthentication(user)
    } catch (error) {
      setAuth({ status: 'anonymous', user: null, error: error.message })
    }
  }

  async function handleLogout() {
    try {
      await logoutAccount()
    } finally {
      setAuth({ status: 'anonymous', user: null, error: '' })
      setSelectedFolderId('all')
      setUi((current) => ({ ...current, menuOpen: false, mobilePane: 'list' }))
    }
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

  const chatSummaries = useMemo(() => {
    return state.chats
      .map((chat) => {
        const baseContact = state.contacts.find((item) => item.id === chat.contactId)
        const live = presence[chat.contactId]
        const isTyping = typingByChat[chat.id] === chat.contactId
        const contact =
          baseContact?.backend && baseContact.type === 'private' && baseContact.status !== 'saved'
            ? {
                ...baseContact,
                status: isTyping ? 'typing' : live?.online ? 'online' : 'offline',
                lastSeen: isTyping
                  ? 'typing...'
                  : live?.online
                    ? 'online'
                    : formatLastSeen(live?.lastSeenAt || baseContact.lastSeenAt),
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
  }, [presence, state.chats, state.contacts, state.messages, typingByChat])

  // Reflect total unread count in the browser tab title (Telegram-style "(3) AstraChat").
  useEffect(() => {
    const totalUnread = chatSummaries.reduce((sum, chat) => sum + (chat.unread || 0), 0)
    document.title = totalUnread > 0 ? `(${totalUnread}) ${APP_TITLE}` : APP_TITLE
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

  async function loadMessagesFromServer(chatId) {
    try {
      const { messages: serverMessages } = await getChatMessages(chatId)
      const normalizedMessages = await Promise.all(
        serverMessages.map((message) => normalizeServerMessage(message, state.user.id)),
      )
      setState((current) => ({
        ...current,
        messages: {
          ...current.messages,
          [chatId]: normalizedMessages,
        },
      }))
      sendSocketEvent({ type: 'chat:read', chatId })
    } catch (error) {
      showToast(error.message || 'Could not load messages.')
    }
  }

  function selectChat(chatId) {
    const chat = state.chats.find((item) => item.id === chatId)
    setSelectedChatId(chatId)
    setMessageSearch('')
    setSelectedMessageId('')
    setReplyToId('')
    setEditingMessageId('')
    setUi((current) => ({
      ...current,
      mobilePane: 'chat',
      searchOpen: false,
      profileOpen: false,
      menuOpen: false,
    }))
    setState((current) => ({
      ...current,
      chats: current.chats.map((chat) => (chat.id === chatId ? { ...chat, unread: 0 } : chat)),
    }))
    if (chat?.backend) {
      loadMessagesFromServer(chatId)
      sendSocketEvent({ type: 'chat:read', chatId })
    }
  }

  const handleTyping = useCallback(
    (active) => {
      if (!selectedChat?.backend) return
      sendSocketEvent({ type: 'typing', chatId: selectedChat.id, active })
    },
    [selectedChat?.backend, selectedChat?.id, sendSocketEvent],
  )

  async function sendMessage(text) {
    if (!selectedChat) return

    if (editingMessage) {
      if (selectedChat.backend) {
        try {
          const encryptedText = await encryptTextForChat(text, selectedChat)
          await editChatMessage(selectedChat.id, editingMessage.id, encryptedText)
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
          replyToId: replyTo?.id,
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
        showToast(error.message || 'Message was not sent.')
      }
      return
    }

    window.setTimeout(() => updateMessageStatus(selectedChat.id, id, 'sent'), 450)
    window.setTimeout(() => updateMessageStatus(selectedChat.id, id, 'delivered'), 900)
    window.setTimeout(() => updateMessageStatus(selectedChat.id, id, 'read'), 1500)
  }

  async function forwardMessageToChat(sourceMessage, targetChatId) {
    const targetChat = state.chats.find((chat) => chat.id === targetChatId)
    if (!targetChat || !sourceMessage || sourceMessage.deleted) return
    const text = sourceMessage.text?.trim()
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

  function sendMockMessage(text) {
    if (!selectedChat) return
    const now = new Date().toISOString()
    setState((current) => ({
      ...current,
      messages: {
        ...current.messages,
        [selectedChat.id]: [
          ...(current.messages[selectedChat.id] || []),
          {
            id: createId('msg'),
            senderId: current.user.id,
            text,
            time: now,
            status: 'read',
            replyToId: replyTo?.id,
            reactions: {},
            mock: true,
          },
        ],
      },
    }))
    setReplyToId('')
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
    if (!message.text) return
    try {
      await navigator.clipboard.writeText(message.text)
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
            { id: contactId, encryptionPublicKey: contact.encryptionPublicKey },
          ],
          pinned: Boolean(chatSettings.pinned),
          pinnedAt: chatSettings.pinnedAt || null,
          muted: Boolean(chatSettings.muted),
          mutedUntil: chatSettings.mutedUntil || null,
          archived: Boolean(chatSettings.archived),
          archivedAt: chatSettings.archivedAt || null,
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

  async function sendAttachment(file, caption) {
    if (!selectedChat) return

    if (!selectedChat.backend) {
      const mediaUrl = URL.createObjectURL(file)
      const localKind = file.type.startsWith('image/')
        ? 'image'
        : file.type.startsWith('video/')
          ? 'video'
          : file.type.startsWith('audio/')
            ? 'voice'
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

    showToast('Preparing encrypted media...')
    try {
      const encryptedCaption = await encryptTextForChat(caption, selectedChat)
      const encryptedMedia = await encryptMediaForChat(file, selectedChat)
      const { media } = await uploadMedia(encryptedMedia.file, selectedChat.id, encryptedMedia.metadata)
      const { message } = await sendChatMessage(selectedChat.id, {
        text: encryptedCaption,
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
      if (savedPercent) {
        showToast(`Media sent. Compressed by ${savedPercent}%.`)
      } else if (encryptedMedia.metadata.kind === 'video' && !encryptedMedia.compressed) {
        showToast('Video sent encrypted. Browser compression was not available.')
      } else {
        showToast('Media sent.')
      }
    } catch (error) {
      showToast(error.message || 'Media upload failed.')
      throw error
    }
  }

  function createSpace({ type, name, username, bio }) {
    const entityId = createId(type)
    const chatId = createId('chat')
    const avatar = name
      .split(/\s+/)
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase()

    const entity = {
      id: entityId,
      type,
      name,
      username,
      avatar: avatar || (type === 'group' ? 'GR' : 'CH'),
      color: type === 'group' ? '#14b8a6' : '#f97316',
      status: type,
      lastSeen: type === 'group' ? '1 member, 1 online' : '1 subscriber',
      phone: '',
      bio: bio || (type === 'group' ? 'Local group created in MVP.' : 'Local channel created in MVP.'),
      members: type === 'group' ? ['me'] : undefined,
      subscribers: type === 'channel' ? 1 : undefined,
      role: 'owner',
    }

    setState((current) => ({
      ...current,
      contacts: [entity, ...current.contacts],
      chats: [
        {
          id: chatId,
          contactId: entityId,
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
        [chatId]: [
          {
            id: createId('msg'),
            senderId: entityId,
            text:
              type === 'group'
                ? 'Group created locally. Members, roles, topics and moderation are prepared as UI/mock states.'
                : 'Channel created locally. Publishing, views, discussions and scheduled posts are prepared as UI/mock states.',
            time: new Date().toISOString(),
            status: 'read',
            reactions: {},
          },
        ],
      },
    }))
    setSelectedChatId(chatId)
    setUi((current) => ({ ...current, createSpace: '', menuOpen: false, mobilePane: 'chat' }))
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
      name: String(user.name || '').trim().slice(0, 64) || 'AstraChat User',
      username: String(user.username || '')
        .replace(/^@+/, '')
        .trim()
        .toLowerCase()
        .slice(0, 32),
      bio: String(user.bio || '').trim().slice(0, 240),
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
      avatar: user.avatar,
      encryptionPublicKey: user.encryptionPublicKey || state.user.encryptionPublicKey,
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

  async function loadSessions() {
    const { sessions } = await getSessions()
    return sessions
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
        onLogin={handleLogin}
        onRegister={handleRegister}
        onTestLogin={handleTestLogin}
      />
    )
  }

  return (
    <AppShell
      chatSummaries={chatSummaries}
      chatFolders={state.chatFolders || EMPTY_CHAT_FOLDERS}
      selectedFolderId={selectedFolderId}
      contacts={state.contacts}
      user={state.user}
      settings={state.settings}
      wordStreamWords={wordStreamWords}
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
      onSelectChat={selectChat}
      onSelectFolder={setSelectedFolderId}
      onSidebarSearch={setSidebarSearch}
      onMessageSearch={setMessageSearch}
      onSendMessage={sendMessage}
      onSendAttachment={sendAttachment}
      onTyping={handleTyping}
      onStartReply={startReply}
      onStartEdit={startEdit}
      onCancelReply={() => setReplyToId('')}
      onCancelEdit={() => setEditingMessageId('')}
      onDeleteMessage={deleteMessage}
      onCopyMessage={copyMessage}
      onReact={reactToMessage}
      onForwardMessage={forwardMessageToChat}
      onSelectMessage={(id) => setSelectedMessageId((current) => (current === id ? '' : id))}
      onTogglePin={(chatId) => toggleChatField(chatId, 'pinned')}
      onToggleMute={(chatId) => toggleChatField(chatId, 'muted')}
      onArchiveChat={archiveChat}
      onCreateFolder={createFolder}
      onUpdateFolder={saveFolder}
      onDeleteFolder={removeFolder}
      onToggleFolderPin={toggleFolderChatPin}
      onExportEncryptionKey={exportEncryptionKey}
      onImportEncryptionKey={importEncryptionKey}
      onUploadAvatar={uploadUserAvatar}
      onRemoveAvatar={removeUserAvatar}
      onChangePassword={changeUserPassword}
      onDeleteAccount={removeAccount}
      onLoadSessions={loadSessions}
      onTerminateOtherSessions={endOtherSessions}
      onTerminateSession={endSession}
      onCreateChat={createChat}
      onCreateSpace={createSpace}
      onSendMockMessage={sendMockMessage}
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
        if (!selectedChat?.backend || !selectedContact?.backend || selectedChat.type !== 'private') {
          showToast('Calls are available in registered-user private chats.')
          return
        }
        callController.startCall({
          contact: selectedContact,
          chatId: selectedChat.id,
          kind,
        })
      }}
      onResetState={resetState}
      onLogout={handleLogout}
      onBackToList={() => setUi((current) => ({ ...current, mobilePane: 'list' }))}
    />
  )
}
