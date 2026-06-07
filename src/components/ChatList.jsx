import ChatItem from './ChatItem'

export default function ChatList({
  chats,
  selectedChatId,
  search,
  showArchived,
  onSelectChat,
  onTogglePin,
  onToggleMute,
  onArchiveChat,
}) {
  const normalized = search.trim().toLowerCase()
  const visibleChats = chats.filter((chat) => {
    if (chat.archived !== showArchived) return false
    if (!normalized) return true
    return [chat.contact.name, chat.contact.username, chat.lastMessageText]
      .filter(Boolean)
      .some((value) => value.toLowerCase().includes(normalized))
  })

  if (!visibleChats.length) {
    return (
      <div className="empty-list">
        <strong>No chats found</strong>
        <span>Try another query or create a private chat, group or channel.</span>
      </div>
    )
  }

  return (
    <div className="chat-list">
      {visibleChats.map((chat) => (
        <ChatItem
          key={chat.id}
          chat={chat}
          selected={chat.id === selectedChatId}
          onSelect={() => onSelectChat(chat.id)}
          onTogglePin={() => onTogglePin(chat.id)}
          onToggleMute={() => onToggleMute(chat.id)}
          onArchive={() => onArchiveChat(chat.id)}
        />
      ))}
    </div>
  )
}
