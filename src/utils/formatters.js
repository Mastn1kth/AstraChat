export function formatChatTime(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  if (sameDay) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function formatMessageTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function formatDateDivider(iso) {
  const date = new Date(iso)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)

  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
}

export function getLastMessage(messages) {
  const visible = messages.filter((message) => !message.deleted)
  return visible[visible.length - 1]
}

export function byPinnedThenRecent(a, b) {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  const aTime = a.lastMessageTime ? new Date(a.lastMessageTime).getTime() : 0
  const bTime = b.lastMessageTime ? new Date(b.lastMessageTime).getTime() : 0
  return bTime - aTime
}
