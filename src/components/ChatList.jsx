import ChatItem from './ChatItem'

export default function ChatList({
  chats,
  selectedChatId,
  folderTitle,
  canPinInFolder,
  onSelectChat,
  onTogglePin,
  onToggleMute,
  onArchiveChat,
  onToggleFolderPin,
}) {
  if (!chats.length) {
    return (
      <div className="empty-list">
        <strong>No chats found</strong>
        <span>{folderTitle ? `${folderTitle} is empty.` : 'Try another query or create a chat.'}</span>
      </div>
    )
  }

  return (
    <div className="chat-list">
      {chats.map((chat) => (
        <ChatItem
          key={chat.id}
          chat={chat}
          selected={chat.id === selectedChatId}
          canPinInFolder={canPinInFolder}
          onSelect={() => onSelectChat(chat.id)}
          onTogglePin={() => onTogglePin(chat.id)}
          onToggleMute={() => onToggleMute(chat.id)}
          onArchive={() => onArchiveChat(chat.id)}
          onToggleFolderPin={() => onToggleFolderPin(chat.id)}
        />
      ))}
    </div>
  )
}
