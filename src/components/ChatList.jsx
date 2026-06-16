import ChatItem from './ChatItem'
import CatchUpBanner from './CatchUpBanner'

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
        <strong>Чаты не найдены</strong>
        <span>{folderTitle ? `${folderTitle} пуст.` : 'Попробуйте другой запрос или создайте чат.'}</span>
      </div>
    )
  }

  // eslint-disable-next-line react-hooks/purity -- mute expiry must compare against the actual current time
  const now = Date.now()
  const active = chats.filter((c) => !c.muted || (c.muteUntil && new Date(c.muteUntil).getTime() < now))
  const snoozed = chats.filter((c) => c.muted && (!c.muteUntil || new Date(c.muteUntil).getTime() >= now))

  function renderItem(chat) {
    return (
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
    )
  }

  return (
    <div className="chat-list">
      <CatchUpBanner chats={chats} onCatchUp={() => {
        const first = chats.find((c) => c.unread > 0 && !c.archived)
        if (first) onSelectChat(first.id)
      }} />
      {active.map(renderItem)}
      {snoozed.length > 0 && (
        <>
          <div className="chat-group-label">
            <span>Отложено</span>
            <span className="line" />
          </div>
          {snoozed.map(renderItem)}
        </>
      )}
    </div>
  )
}
