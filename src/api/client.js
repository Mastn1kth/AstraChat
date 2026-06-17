// Base URL for the API server. Empty in the web build (same-origin via the Vite
// proxy or the production reverse proxy); set VITE_API_BASE for native builds
// (Capacitor) where the app bundle is served from a local origin.
export const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '')

const inFlightRequests = new Map()

async function performRequest(path, options = {}) {
  const isFormData = options.body instanceof FormData
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: API_BASE ? 'include' : 'same-origin',
    headers: {
      ...(options.body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    ...options,
  })

  const data = response.status === 204 ? null : await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(data?.error || `Request failed with status ${response.status}`)
    error.status = response.status
    error.details = data?.details
    throw error
  }
  return data
}

function request(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase()
  const canDeduplicate = (method === 'GET' || method === 'HEAD') && !options.body && !options.signal
  const key = canDeduplicate ? `${method} ${path}` : ''

  if (key && inFlightRequests.has(key)) {
    return inFlightRequests.get(key)
  }

  const promise = performRequest(path, options)
  if (key) {
    inFlightRequests.set(key, promise)
    const cleanup = () => {
      if (inFlightRequests.get(key) === promise) {
        inFlightRequests.delete(key)
      }
    }
    promise.then(cleanup, cleanup)
  }

  return promise
}

export function getCurrentSession() {
  return request('/api/auth/me')
}

export function registerAccount(input) {
  return request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function loginAccount(input) {
  return request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function startPhoneAuth(input) {
  return request('/api/auth/phone/start', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function verifyPhoneAuth(input) {
  return request('/api/auth/phone/verify', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function testLogin(slot) {
  return request('/api/auth/test-login', {
    method: 'POST',
    body: JSON.stringify({ slot }),
  })
}

export function logoutAccount() {
  return request('/api/auth/logout', { method: 'POST' })
}

export function getSessions() {
  return request('/api/sessions')
}

export function terminateSession(sessionId) {
  return request(`/api/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' })
}

export function terminateOtherSessions() {
  return request('/api/sessions', { method: 'DELETE' })
}

export function getSecurityEvents({ unread = false } = {}) {
  return request(`/api/security/events${unread ? '?unread=true' : ''}`)
}

export function markSecurityEventRead(eventId) {
  return request(`/api/security/events/${encodeURIComponent(eventId)}/read`, { method: 'POST' })
}

export function markAllSecurityEventsRead() {
  return request('/api/security/events/read', { method: 'POST' })
}

export function getBlockedUsers() {
  return request('/api/users/blocks')
}

export function getContacts() {
  return request('/api/contacts')
}

export function addContact(userId) {
  return request(`/api/contacts/${encodeURIComponent(userId)}`, { method: 'POST' })
}

export function removeContact(userId) {
  return request(`/api/contacts/${encodeURIComponent(userId)}`, { method: 'DELETE' })
}

export function blockUser(userId) {
  return request(`/api/users/${encodeURIComponent(userId)}/block`, { method: 'POST' })
}

export function unblockUser(userId) {
  return request(`/api/users/${encodeURIComponent(userId)}/block`, { method: 'DELETE' })
}

export function reportAbuse(input) {
  return request('/api/reports', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function getPushVapidPublicKey() {
  return request('/api/push/vapid-public-key')
}

export function savePushSubscription(subscription) {
  return request('/api/push/subscriptions', {
    method: 'POST',
    body: JSON.stringify({ subscription }),
  })
}

export function deletePushSubscription(endpoint) {
  return request('/api/push/subscriptions', {
    method: 'DELETE',
    body: JSON.stringify(endpoint ? { endpoint } : {}),
  })
}

export function searchUsers(search = '') {
  return request(`/api/users?search=${encodeURIComponent(search)}`)
}

export function updateEncryptionPublicKey(encryptionPublicKey) {
  return request('/api/users/me/encryption-key', {
    method: 'PATCH',
    body: JSON.stringify({ encryptionPublicKey }),
  })
}

export function updateProfile(input) {
  return request('/api/users/me/profile', {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function uploadAvatar(file) {
  const body = new FormData()
  body.append('file', file)
  return request('/api/users/me/avatar', { method: 'POST', body })
}

export function deleteAvatar() {
  return request('/api/users/me/avatar', { method: 'DELETE' })
}

export function changePassword(input) {
  return request('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function getTotpStatus() {
  return request('/api/auth/totp/status')
}

export function startTotpSetup() {
  return request('/api/auth/totp/setup', { method: 'POST' })
}

export function verifyTotpSetup(code) {
  return request('/api/auth/totp/verify', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
}

export function disableTotp(code) {
  return request('/api/auth/totp', {
    method: 'DELETE',
    body: JSON.stringify({ code }),
  })
}

export function getCloudPasswordStatus() {
  return request('/api/auth/cloud-password/status')
}

export function setCloudPassword({ password, hint, currentPassword }) {
  return request('/api/auth/cloud-password', {
    method: 'POST',
    body: JSON.stringify({ password, hint, currentPassword }),
  })
}

export function removeCloudPassword(password) {
  return request('/api/auth/cloud-password', {
    method: 'DELETE',
    body: JSON.stringify({ password }),
  })
}

export function deleteAccount() {
  return request('/api/users/me', { method: 'DELETE' })
}

export function getChats() {
  return request('/api/chats')
}

export function searchEverything(query = '') {
  return request(`/api/search?q=${encodeURIComponent(query)}`)
}

export function createChat(input) {
  return request('/api/chats', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateChatSettings(chatId, input) {
  return request(`/api/chats/${encodeURIComponent(chatId)}/settings`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function getChatFolders() {
  return request('/api/chat-folders')
}

export function createChatFolder(input) {
  return request('/api/chat-folders', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateChatFolder(folderId, input) {
  return request(`/api/chat-folders/${encodeURIComponent(folderId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function deleteChatFolder(folderId) {
  return request(`/api/chat-folders/${encodeURIComponent(folderId)}`, { method: 'DELETE' })
}

export function updateChatFolderChat(folderId, chatId, input) {
  return request(
    `/api/chat-folders/${encodeURIComponent(folderId)}/chats/${encodeURIComponent(chatId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  )
}

export function getChatMessages(chatId, { before, limit } = {}) {
  const params = new URLSearchParams()
  if (before) params.set('before', before)
  if (limit) params.set('limit', String(limit))
  const qs = params.toString()
  return request(`/api/chats/${encodeURIComponent(chatId)}/messages${qs ? `?${qs}` : ''}`)
}

export function getChatMessageContext(chatId, messageId, { limit } = {}) {
  const params = new URLSearchParams()
  if (limit) params.set('limit', String(limit))
  const qs = params.toString()
  return request(
    `/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/context${
      qs ? `?${qs}` : ''
    }`,
  )
}

export function pinChatMessage(chatId, messageId) {
  return request(`/api/chats/${encodeURIComponent(chatId)}/pinned-message`, {
    method: 'PATCH',
    body: JSON.stringify({ messageId }),
  })
}

export function searchChatMessages(chatId, query = '') {
  return request(`/api/chats/${encodeURIComponent(chatId)}/search?q=${encodeURIComponent(query)}`)
}

export function sendChatMessage(chatId, input) {
  return request(`/api/chats/${encodeURIComponent(chatId)}/messages`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function editChatMessage(chatId, messageId, text, searchText = '') {
  return request(
    `/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ text, searchText }),
    },
  )
}

export function deleteChatMessage(chatId, messageId) {
  return request(
    `/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`,
    { method: 'DELETE' },
  )
}

export function deleteChatMessageForMe(chatId, messageId) {
  return request(
    `/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/delete-for-me`,
    { method: 'POST' },
  )
}

export function clearChatHistory(chatId) {
  return request(`/api/chats/${encodeURIComponent(chatId)}/clear-history`, { method: 'POST' })
}

export function toggleMessageReaction(chatId, messageId, emoji) {
  return request(
    `/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/reactions`,
    {
      method: 'POST',
      body: JSON.stringify({ emoji }),
    },
  )
}

export async function uploadMedia(file, chatId, options = {}) {
  const body = new FormData()
  body.append('file', file)
  body.append('chatId', chatId)
  if (options.clientEncrypted) {
    body.append('clientEncrypted', 'true')
    body.append('envelope', options.envelope)
    body.append('kind', options.kind)
    body.append('mimeType', options.mimeType)
    body.append('plainSize', String(options.plainSize || 0))
    body.append('originalSize', String(options.originalSize || 0))
    body.append('originalName', options.originalName || file.name)
    if (options.width) body.append('width', String(options.width))
    if (options.height) body.append('height', String(options.height))
    if (options.durationMs) body.append('durationMs', String(options.durationMs))
  }

  if (options.onUploadProgress || options.signal) {
    return uploadWithProgress('/api/media', body, {
      signal: options.signal,
      onUploadProgress: options.onUploadProgress,
    })
  }

  return request('/api/media', {
    method: 'POST',
    body,
  })
}

function uploadWithProgress(path, body, { signal, onUploadProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_BASE}${path}`)
    xhr.withCredentials = true

    function abortHandler() {
      xhr.abort()
    }

    if (signal) {
      if (signal.aborted) {
        reject(new DOMException('Upload cancelled', 'AbortError'))
        return
      }
      signal.addEventListener('abort', abortHandler, { once: true })
    }

    xhr.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable || !onUploadProgress) return
      onUploadProgress(Math.round((event.loaded / event.total) * 100))
    })

    xhr.addEventListener('load', () => {
      signal?.removeEventListener('abort', abortHandler)
      const data = xhr.status === 204 ? null : JSON.parse(xhr.responseText || 'null')
      if (xhr.status < 200 || xhr.status >= 300) {
        const error = new Error(data?.error || `Request failed with status ${xhr.status}`)
        error.status = xhr.status
        error.details = data?.details
        reject(error)
        return
      }
      resolve(data)
    })

    xhr.addEventListener('error', () => {
      signal?.removeEventListener('abort', abortHandler)
      reject(new Error('Network request failed'))
    })

    xhr.addEventListener('abort', () => {
      signal?.removeEventListener('abort', abortHandler)
      reject(new DOMException('Upload cancelled', 'AbortError'))
    })

    xhr.send(body)
  })
}

export function createServerCall(input) {
  return request('/api/calls', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function getCallHistory(chatId = '') {
  return request(`/api/calls${chatId ? `?chatId=${encodeURIComponent(chatId)}` : ''}`)
}

export function getCallIceServers() {
  return request('/api/calls/ice-servers')
}

export function getLinkPreview(url) {
  return request(`/api/og?url=${encodeURIComponent(url)}`)
}

export function getChatMembers(chatId) {
  return request(`/api/chats/${encodeURIComponent(chatId)}/members`)
}

export function addChatMember(chatId, userId) {
  return request(`/api/chats/${encodeURIComponent(chatId)}/members`, {
    method: 'POST',
    body: JSON.stringify({ userId }),
  })
}

export function removeChatMember(chatId, userId) {
  return request(`/api/chats/${encodeURIComponent(chatId)}/members/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  })
}

export function updateChatInfo(chatId, input) {
  return request(`/api/chats/${encodeURIComponent(chatId)}/info`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function updateChatModeration(chatId, input) {
  return request(`/api/chats/${encodeURIComponent(chatId)}/moderation`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function updateChatMemberRole(chatId, userId, input) {
  return request(
    `/api/chats/${encodeURIComponent(chatId)}/members/${encodeURIComponent(userId)}/role`,
    {
      method: 'PATCH',
      body: JSON.stringify(input),
    },
  )
}

export function updateChatMemberPermissions(chatId, userId, permissions) {
  return request(
    `/api/chats/${encodeURIComponent(chatId)}/members/${encodeURIComponent(userId)}/permissions`,
    {
      method: 'PATCH',
      body: JSON.stringify({ permissions }),
    },
  )
}

export function getChatBans(chatId) {
  return request(`/api/chats/${encodeURIComponent(chatId)}/bans`)
}

export function banChatMember(chatId, input) {
  return request(`/api/chats/${encodeURIComponent(chatId)}/bans`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function unbanChatMember(chatId, userId) {
  return request(`/api/chats/${encodeURIComponent(chatId)}/bans/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
  })
}

export function getChatInvites(chatId) {
  return request(`/api/chats/${encodeURIComponent(chatId)}/invites`)
}

export function createChatInvite(chatId, input) {
  return request(`/api/chats/${encodeURIComponent(chatId)}/invites`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function revokeChatInvite(chatId, inviteId) {
  return request(
    `/api/chats/${encodeURIComponent(chatId)}/invites/${encodeURIComponent(inviteId)}`,
    { method: 'DELETE' },
  )
}

export function joinChatByInvite(token, message = '') {
  return request(`/api/invites/${encodeURIComponent(token)}/join`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  })
}

export function getChatJoinRequests(chatId) {
  return request(`/api/chats/${encodeURIComponent(chatId)}/join-requests`)
}

export function reviewChatJoinRequest(chatId, userId, approved) {
  return request(
    `/api/chats/${encodeURIComponent(chatId)}/join-requests/${encodeURIComponent(userId)}`,
    {
      method: 'POST',
      body: JSON.stringify({ approved }),
    },
  )
}

export function getChatAdminLog(chatId, limit = 50) {
  return request(`/api/chats/${encodeURIComponent(chatId)}/admin-log?limit=${encodeURIComponent(limit)}`)
}

export function getChatTopics(chatId) {
  return request(`/api/chats/${encodeURIComponent(chatId)}/topics`)
}

export function createChatTopic(chatId, input) {
  return request(`/api/chats/${encodeURIComponent(chatId)}/topics`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateChatTopic(chatId, topicId, input) {
  return request(`/api/chats/${encodeURIComponent(chatId)}/topics/${encodeURIComponent(topicId)}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function getChatDiscussion(chatId) {
  return request(`/api/chats/${encodeURIComponent(chatId)}/discussion`)
}

export function setChatDiscussion(chatId, groupId) {
  return request(`/api/chats/${encodeURIComponent(chatId)}/discussion`, {
    method: 'PUT',
    body: JSON.stringify({ groupId: groupId || null }),
  })
}

export function getChatMedia(chatId, { kinds, before, limit } = {}) {
  const params = new URLSearchParams()
  if (kinds?.length) kinds.forEach((k) => params.append('kind', k))
  if (before) params.set('before', before)
  if (limit) params.set('limit', String(limit))
  const qs = params.toString()
  return request(`/api/chats/${encodeURIComponent(chatId)}/media${qs ? `?${qs}` : ''}`)
}

export function getScheduledMessages(chatId) {
  return request(`/api/chats/${encodeURIComponent(chatId)}/scheduled-messages`)
}

export function sendScheduledMessageNow(chatId, messageId) {
  return request(
    `/api/chats/${encodeURIComponent(chatId)}/scheduled-messages/${encodeURIComponent(messageId)}/send-now`,
    { method: 'POST' },
  )
}

export function deleteScheduledMessage(chatId, messageId) {
  return request(
    `/api/chats/${encodeURIComponent(chatId)}/scheduled-messages/${encodeURIComponent(messageId)}`,
    { method: 'DELETE' },
  )
}

export function votePoll(chatId, messageId, optionIds) {
  return request(
    `/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/poll-votes`,
    {
      method: 'POST',
      body: JSON.stringify({ optionIds }),
    },
  )
}

export function markChannelPostViewed(chatId, messageId) {
  return request(
    `/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/view`,
    { method: 'POST' },
  )
}

export function getChannelStats(chatId) {
  return request(`/api/chats/${encodeURIComponent(chatId)}/channel-stats`)
}

export function getWallMessages() {
  return request('/api/wall')
}

export function sendWallMessage(text) {
  return request('/api/wall', {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
}

export function saveFcmToken(token) {
  return request('/api/push/fcm-token', {
    method: 'POST',
    body: JSON.stringify({ token }),
  })
}

export function getCloudKeyBackup() {
  return request('/api/keys/backup')
}

export function putCloudKeyBackup(payload) {
  return request('/api/keys/backup', {
    method: 'PUT',
    body: JSON.stringify({ payload }),
  })
}

export function deleteCloudKeyBackup() {
  return request('/api/keys/backup', { method: 'DELETE' })
}

export function getMessageReadBy(chatId, messageId) {
  return request(
    `/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/read-by`,
  )
}
