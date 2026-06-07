async function request(path, options = {}) {
  const isFormData = options.body instanceof FormData
  const response = await fetch(path, {
    credentials: 'same-origin',
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

export function editChatMessage(chatId, messageId, text) {
  return request(
    `/api/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ text }),
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
  return request('/api/media', {
    method: 'POST',
    body,
  })
}

export function createServerCall(input) {
  return request('/api/calls', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function getLinkPreview(url) {
  return request(`/api/link-preview?url=${encodeURIComponent(url)}`)
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
