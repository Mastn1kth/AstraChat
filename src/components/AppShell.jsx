import { useRef, useState } from 'react'
import { Pin, X } from 'lucide-react'
import Sidebar from './Sidebar'
import ChatHeader from './ChatHeader'
import MessageList from './MessageList'
import Composer from './Composer'
import SearchPanel from './SearchPanel'
import ContactModal from './ContactModal'
import CreateSpaceModal from './CreateSpaceModal'
import ProfilePanel from './ProfilePanel'
import CallModal from './CallModal'
import WordStreamBackground from './WordStreamBackground'
import MediaViewer from './MediaViewer'
import ForwardModal from './ForwardModal'

export default function AppShell({
  chatSummaries,
  chatFolders,
  selectedFolderId,
  contacts,
  user,
  settings,
  wordStreamWords,
  selectedChat,
  selectedContact,
  messages,
  messageSearch,
  sidebarSearch,
  ui,
  replyTo,
  editingMessage,
  selectedMessageId,
  toast,
  callController,
  hasMoreMessages,
  selectedMessageIds,
  onLoadMoreMessages,
  onToggleMessageSelection,
  onClearMessageSelection,
  onDeleteSelectedMessages,
  onForwardSelectedMessages,
  onPinMessage,
  onRetryMessage,
  onSelectChat,
  onSelectFolder,
  onSidebarSearch,
  onMessageSearch,
  onSendMessage,
  onSendAttachment,
  onTyping,
  onStartReply,
  onStartEdit,
  onCancelReply,
  onCancelEdit,
  onDeleteMessage,
  onCopyMessage,
  onReact,
  onForwardMessage,
  onSelectMessage,
  onTogglePin,
  onMuteChat,
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
  onLoadGroupMembers,
  onAddGroupMember,
  onRemoveGroupMember,
  onUpdateGroupInfo,
  onCreateChat,
  onCreateSpace,
  onSendMockMessage,
  onOpenContacts,
  onCloseContacts,
  onOpenCreateSpace,
  onCloseCreateSpace,
  onUpdateSettings,
  onUpdateUser,
  onOpenProfile,
  onCloseProfile,
  onToggleSearch,
  onToggleMenu,
  onOpenCall,
  onResetState,
  onLogout,
  onBackToList,
}) {
  const hasChat = selectedChat && selectedContact
  const wordStreamEnabled = settings.wordStream.enabled && wordStreamWords.length > 0
  const [openMedia, setOpenMedia] = useState(null)
  const [forwardMessage, setForwardMessage] = useState(null)
  const [forwardingSelected, setForwardingSelected] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const dragCounterRef = useRef(0)
  const multiSelectMode = selectedMessageIds.size > 0

  const pinnedMessageId = selectedChat?.pinnedMessageId || null
  const pinnedMessage = pinnedMessageId
    ? messages.find((m) => m.id === pinnedMessageId) || null
    : null

  function handleDragEnter(e) {
    if (!hasChat) return
    e.preventDefault()
    dragCounterRef.current += 1
    if (dragCounterRef.current === 1) setDragOver(true)
  }
  function handleDragLeave() {
    dragCounterRef.current -= 1
    if (dragCounterRef.current === 0) setDragOver(false)
  }
  function handleDragOver(e) { e.preventDefault() }
  function handleDrop(e) {
    e.preventDefault()
    dragCounterRef.current = 0
    setDragOver(false)
    if (!hasChat || multiSelectMode) return
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    if (file.size > 100 * 1024 * 1024) return
    onSendAttachment(file, '')
  }

  return (
    <div
      className={`app-shell ${ui.mobilePane === 'chat' ? 'show-chat' : 'show-list'} ${
        wordStreamEnabled ? 'word-stream-enabled' : ''
      }`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {dragOver && hasChat && (
        <div className="drag-overlay">
          <div className="drag-overlay-inner">
            <span>Drop to send file</span>
          </div>
        </div>
      )}
      <WordStreamBackground words={wordStreamWords} settings={settings.wordStream} />
      <Sidebar
        chats={chatSummaries}
        chatFolders={chatFolders}
        selectedFolderId={selectedFolderId}
        contacts={contacts}
        user={user}
        settings={settings}
        selectedChatId={selectedChat?.id}
        search={sidebarSearch}
        menuOpen={ui.menuOpen}
        onSearch={onSidebarSearch}
        onSelectChat={onSelectChat}
        onSelectFolder={onSelectFolder}
        onOpenCreateSpace={onOpenCreateSpace}
        onCreateChat={onCreateChat}
        onUpdateSettings={onUpdateSettings}
        onUpdateUser={onUpdateUser}
        onResetState={onResetState}
        onLogout={onLogout}
        onToggleMenu={onToggleMenu}
        onTogglePin={onTogglePin}
        onToggleMute={onToggleMute}
        onArchiveChat={onArchiveChat}
        onCreateFolder={onCreateFolder}
        onUpdateFolder={onUpdateFolder}
        onDeleteFolder={onDeleteFolder}
        onToggleFolderPin={onToggleFolderPin}
        onExportEncryptionKey={onExportEncryptionKey}
        onImportEncryptionKey={onImportEncryptionKey}
        onUploadAvatar={onUploadAvatar}
        onRemoveAvatar={onRemoveAvatar}
        onChangePassword={onChangePassword}
        onDeleteAccount={onDeleteAccount}
        onLoadSessions={onLoadSessions}
        onTerminateOtherSessions={onTerminateOtherSessions}
        onTerminateSession={onTerminateSession}
      />

      <main className="chat-area" data-chat-bg={settings.chatBackground || 'default'}>
        {hasChat ? (
          <>
            <ChatHeader
              contact={selectedContact}
              chat={selectedChat}
              onBack={onBackToList}
              onOpenProfile={onOpenProfile}
              onToggleSearch={onToggleSearch}
              onTogglePin={() => onTogglePin(selectedChat.id)}
              onMuteChat={(mutedUntil) => onMuteChat(selectedChat.id, mutedUntil)}
              onToggleMute={() => onToggleMute(selectedChat.id)}
              onArchive={() => onArchiveChat(selectedChat.id)}
              onOpenCall={onOpenCall}
            />
            {pinnedMessageId && (
              <div className="pinned-message-bar" onClick={() => {
                const el = document.querySelector(`[data-message-id="${pinnedMessageId}"]`)
                el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
              }}>
                <Pin size={14} className="pinned-icon" />
                <span className="pinned-text">
                  {pinnedMessage ? (pinnedMessage.text || 'Media message') : 'Pinned message'}
                </span>
                <button
                  className="pinned-close"
                  onClick={(event) => {
                    event.stopPropagation()
                    onPinMessage(null)
                  }}
                  aria-label="Unpin message"
                >
                  <X size={14} />
                </button>
              </div>
            )}
            <MessageList
              messages={messages}
              contact={selectedContact}
              currentUser={user}
              search={messageSearch}
              selectedMessageId={selectedMessageId}
              selectedMessageIds={selectedMessageIds}
              multiSelectMode={multiSelectMode}
              hasMore={hasMoreMessages}
              onSelectMessage={onSelectMessage}
              onToggleMessageSelection={onToggleMessageSelection}
              onLoadMore={onLoadMoreMessages}
              onStartReply={onStartReply}
              onStartEdit={onStartEdit}
              onDeleteMessage={onDeleteMessage}
              onCopyMessage={onCopyMessage}
              onReact={onReact}
              onOpenMedia={setOpenMedia}
              onForwardMessage={setForwardMessage}
              onPinMessage={onPinMessage}
              onRetryMessage={onRetryMessage}
            />
            {multiSelectMode ? (
              <div className="multiselect-bar">
                <button onClick={onClearMessageSelection} className="multiselect-cancel">
                  <X size={16} /> Cancel
                </button>
                <span>{selectedMessageIds.size} selected</span>
                <div className="multiselect-actions">
                  <button
                    onClick={() => {
                      setForwardingSelected(true)
                      setForwardMessage({ _multi: true })
                    }}
                  >
                    Forward
                  </button>
                  <button className="danger" onClick={onDeleteSelectedMessages}>
                    Delete
                  </button>
                </div>
              </div>
            ) : (
              <Composer
                key={`${selectedChat.id}-${editingMessage?.id || 'compose'}`}
                chatId={selectedChat.id}
                replyTo={replyTo}
                editingMessage={editingMessage}
                onSend={onSendMessage}
                onSendAttachment={onSendAttachment}
                onTyping={onTyping}
                onCancelReply={onCancelReply}
                onCancelEdit={onCancelEdit}
                onAttach={(message) => onUpdateSettings({ toast: message })}
                onMockSend={onSendMockMessage}
              />
            )}
          </>
        ) : (
          <section className="empty-chat">
            <div className="empty-mark">A</div>
            <h1>AstraChat</h1>
            <p>Select a private conversation or start a new one from contacts.</p>
            <button className="primary-button" onClick={onOpenContacts}>
              New private chat
            </button>
          </section>
        )}
      </main>

      {ui.searchOpen && hasChat && (
        <SearchPanel
          query={messageSearch}
          messages={messages}
          contact={selectedContact}
          currentUser={user}
          onQuery={onMessageSearch}
          onClose={onToggleSearch}
          onSelect={onSelectMessage}
        />
      )}

      {ui.profileOpen && hasChat && (
        <ProfilePanel
          contact={selectedContact}
          chat={selectedChat}
          contacts={contacts}
          messages={messages}
          currentUserId={user.id}
          onMockAction={onSendMockMessage}
          onClose={onCloseProfile}
          onTogglePin={() => onTogglePin(selectedChat.id)}
          onToggleMute={() => onToggleMute(selectedChat.id)}
          onArchive={() => onArchiveChat(selectedChat.id)}
          onOpenMedia={setOpenMedia}
          onLoadGroupMembers={onLoadGroupMembers}
          onAddGroupMember={onAddGroupMember}
          onRemoveGroupMember={onRemoveGroupMember}
          onUpdateGroupInfo={onUpdateGroupInfo}
        />
      )}

      {ui.contactsOpen && (
        <ContactModal
          contacts={contacts}
          chats={chatSummaries}
          onCreateChat={onCreateChat}
          onClose={onCloseContacts}
        />
      )}

      {ui.createSpace && (
        <CreateSpaceModal mode={ui.createSpace} onCreate={onCreateSpace} onClose={onCloseCreateSpace} />
      )}

      {callController.call && (
        <CallModal
          call={callController.call}
          localStream={callController.localStream}
          remoteStream={callController.remoteStream}
          onAccept={callController.acceptCall}
          onEnd={callController.endCall}
          onDismiss={callController.dismissCall}
          onToggleMute={callController.toggleMute}
          onToggleCamera={callController.toggleCamera}
          onToggleSpeaker={callController.toggleSpeaker}
          onToggleScreenShare={callController.toggleScreenShare}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
      <MediaViewer media={openMedia} onClose={() => setOpenMedia(null)} />
      <ForwardModal
        message={forwardMessage}
        chats={chatSummaries}
        onClose={() => {
          setForwardMessage(null)
          setForwardingSelected(false)
        }}
        onForward={(chatId) => {
          if (forwardingSelected) {
            onForwardSelectedMessages(chatId)
          } else {
            onForwardMessage(forwardMessage, chatId)
          }
          setForwardMessage(null)
          setForwardingSelected(false)
        }}
      />
    </div>
  )
}
