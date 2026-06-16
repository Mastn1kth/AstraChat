import { useEffect, useRef, useState } from 'react'
import { Pin, X } from 'lucide-react'
import Sidebar from './Sidebar'
import GlobalSearchPanel from './GlobalSearchPanel'
import ChatHeader from './ChatHeader'
import MessageList from './MessageList'
import Composer from './Composer'
import SearchPanel from './SearchPanel'
import ContactModal from './ContactModal'
import CreateSpaceModal from './CreateSpaceModal'
import ProfilePanel from './ProfilePanel'
import CallModal from './CallModal'
import WordStreamBackground from './WordStreamBackground'
import LiveWallBackground from './LiveWallBackground'
import MediaViewer from './MediaViewer'
import ForwardModal from './ForwardModal'
import DownloadManager from './DownloadManager'
import CatchUpBanner from './CatchUpBanner'
import ScheduledPanel from './ScheduledPanel'
import { t } from '../i18n'

export default function AppShell({
  chatSummaries,
  chatFolders,
  selectedFolderId,
  contacts,
  user,
  settings,
  wordStreamWords,
  allMessages,
  wallMessages,
  liveWallChatWords,
  onSendWallMessage,
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
  typingUsers,
  onLoadMoreMessages,
  onToggleMessageSelection,
  onClearMessageSelection,
  onDeleteSelectedMessages,
  onForwardSelectedMessages,
  onPinMessage,
  onRetryMessage,
  onVotePoll,
  unreadFromId,
  onSelectChat,
  onSelectFolder,
  onSidebarSearch,
  onMessageSearch,
  onSendMessage,
  onSendAttachment,
  onSendAttachments,
  onSendRichMessage,
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
  onJumpToMessage,
  onTogglePin,
  onMuteChat,
  onToggleMute,
  onSetChatPushMode,
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
  onTerminateOtherSessions,
  onTerminateSession,
  onLoadSecurityAlerts,
  onMarkSecurityAlertRead,
  onMarkAllSecurityAlertsRead,
  onLoadBlockedContacts,
  onBlockUser,
  onUnblockUser,
  onReportUser,
  onReportMessage,
  onLoadGroupMembers,
  onLoadCallHistory,
  onAddGroupMember,
  onRemoveGroupMember,
  onUpdateGroupInfo,
  onUpdateGroupMemberRole,
  onUpdateGroupMemberPermissions,
  onCreateChat,
  onCreateSpace,
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
  onGlobalSearchSelectChat,
  onGlobalSearchJumpMessage,
  onScheduleSend,
  scheduledCounts,
}) {
  const hasChat = selectedChat && selectedContact
  const liveWallEnabled = Boolean(settings.liveWall?.enabled)
  const wordStreamEnabled =
    (settings.wordStream.enabled && wordStreamWords.length > 0) || liveWallEnabled
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false)
  const [scheduledPanelOpen, setScheduledPanelOpen] = useState(false)
  const [openMedia, setOpenMedia] = useState(null)
  const [forwardMessage, setForwardMessage] = useState(null)
  const [forwardingSelected, setForwardingSelected] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [downloads, setDownloads] = useState({})
  const dragCounterRef = useRef(0)
  const downloadRequestsRef = useRef({})
  const multiSelectMode = selectedMessageIds.size > 0
  const privateBlocked = selectedContact?.type === 'private' && (
    selectedContact.blockedByMe ||
    selectedContact.blockedMe ||
    selectedChat?.members?.some((member) => member.blockedByMe || member.blockedMe)
  )
  const blockedByMe = selectedContact?.blockedByMe ||
    selectedChat?.members?.some((member) => member.id === selectedContact?.id && member.blockedByMe)

  useEffect(() => {
    function onKey(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setGlobalSearchOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
    const files = Array.from(e.dataTransfer.files || []).filter((file) => file.size <= 100 * 1024 * 1024)
    if (!files.length) return
    onSendAttachments(files, '')
  }

  function startDownload(media) {
    if (!media?.url) return
    const id = `${media.id || media.url}-${Date.now()}`
    const xhr = new XMLHttpRequest()
    downloadRequestsRef.current[id] = xhr
    setDownloads((current) => ({
      ...current,
      [id]: {
        id,
        name: media.name || `${media.kind || 'media'}`,
        progress: 0,
        status: 'downloading',
        media,
      },
    }))

    xhr.open('GET', media.url)
    xhr.withCredentials = true
    xhr.responseType = 'blob'
    xhr.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return
      const progress = Math.round((event.loaded / event.total) * 100)
      setDownloads((current) => ({
        ...current,
        [id]: current[id] ? { ...current[id], progress } : current[id],
      }))
    })
    xhr.addEventListener('load', () => {
      delete downloadRequestsRef.current[id]
      if (xhr.status < 200 || xhr.status >= 300) {
        setDownloads((current) => ({
          ...current,
          [id]: current[id] ? { ...current[id], status: 'failed' } : current[id],
        }))
        return
      }
      const url = URL.createObjectURL(xhr.response)
      const link = document.createElement('a')
      link.href = url
      link.download = media.name || 'download'
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setDownloads((current) => ({
        ...current,
        [id]: current[id] ? { ...current[id], progress: 100, status: 'done' } : current[id],
      }))
    })
    xhr.addEventListener('error', () => {
      delete downloadRequestsRef.current[id]
      setDownloads((current) => ({
        ...current,
        [id]: current[id] ? { ...current[id], status: 'failed' } : current[id],
      }))
    })
    xhr.addEventListener('abort', () => {
      delete downloadRequestsRef.current[id]
      setDownloads((current) => {
        const next = { ...current }
        delete next[id]
        return next
      })
    })
    xhr.send()
  }

  function cancelDownload(id) {
    downloadRequestsRef.current[id]?.abort()
  }

  function retryDownload(id) {
    const item = downloads[id]
    if (!item?.media) return
    setDownloads((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
    startDownload(item.media)
  }

  function openMediaViewer(media, sourceMessage = null) {
    if (!media) return
    const isVisualMedia = (item) => item?.media && ['image', 'video'].includes(item.media.kind) && !item.media.decryptFailed
    const albumItems = sourceMessage?.albumId
      ? messages.filter((message) => message.albumId === sourceMessage.albumId && isVisualMedia(message))
      : []
    const items = albumItems.length ? albumItems.map((message) => message.media) : [media]
    const index = Math.max(
      0,
      items.findIndex((item) => (item.id && item.id === media.id) || item.url === media.url),
    )
    setOpenMedia({ media, items, index })
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
            <span>{t('chat.dropToSend')}</span>
          </div>
        </div>
      )}
      <WordStreamBackground words={wordStreamWords} settings={settings.wordStream} />
      <LiveWallBackground
        messages={wallMessages || []}
        chatWords={liveWallChatWords}
        settings={settings.liveWall}
      />
      <CatchUpBanner
        chats={chatSummaries}
        onCatchUp={() => {
          const next = chatSummaries.find((c) => c.unread > 0 && !c.archived)
          if (next) onSelectChat(next.id)
        }}
      />
      <Sidebar
        chats={chatSummaries}
        chatFolders={chatFolders}
        selectedFolderId={selectedFolderId}
        contacts={contacts}
        user={user}
        settings={settings}
        allMessages={allMessages}
        selectedChatId={selectedChat?.id}
        search={sidebarSearch}
        menuOpen={ui.menuOpen}
        onSearch={onSidebarSearch}
        onOpenGlobalSearch={() => setGlobalSearchOpen(true)}
        onSelectChat={onSelectChat}
        onSelectFolder={onSelectFolder}
        onOpenCreateSpace={onOpenCreateSpace}
        onCreateChat={onCreateChat}
        onUpdateSettings={onUpdateSettings}
        onUpdateUser={onUpdateUser}
        onSendWallMessage={onSendWallMessage}
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
        onCloudKeyBackup={onCloudKeyBackup}
        onCloudKeyRestore={onCloudKeyRestore}
        onUploadAvatar={onUploadAvatar}
        onRemoveAvatar={onRemoveAvatar}
        onChangePassword={onChangePassword}
        onDeleteAccount={onDeleteAccount}
        onLoadSessions={onLoadSessions}
        onLoadTotpStatus={onLoadTotpStatus}
        onStartTotpSetup={onStartTotpSetup}
        onVerifyTotpSetup={onVerifyTotpSetup}
        onDisableTotp={onDisableTotp}
        onTerminateOtherSessions={onTerminateOtherSessions}
        onTerminateSession={onTerminateSession}
        onLoadSecurityAlerts={onLoadSecurityAlerts}
        onMarkSecurityAlertRead={onMarkSecurityAlertRead}
        onMarkAllSecurityAlertsRead={onMarkAllSecurityAlertsRead}
        onLoadBlockedContacts={onLoadBlockedContacts}
        onUnblockUser={onUnblockUser}
      />

      <main className="chat-area" data-chat-bg={settings.chatBackground || 'default'}>
        {hasChat ? (
          <>
            <ChatHeader
              contact={selectedContact}
              chat={selectedChat}
              scheduledCount={scheduledCounts?.[selectedChat.id] || 0}
              onBack={onBackToList}
              onOpenProfile={onOpenProfile}
              onToggleSearch={onToggleSearch}
              onTogglePin={() => onTogglePin(selectedChat.id)}
              onMuteChat={(mutedUntil) => onMuteChat(selectedChat.id, mutedUntil)}
              onToggleMute={() => onToggleMute(selectedChat.id)}
              onSetPushMode={(pushMode) => onSetChatPushMode(selectedChat.id, pushMode)}
              onArchive={() => onArchiveChat(selectedChat.id)}
              onOpenCall={onOpenCall}
              onOpenScheduled={selectedChat.backend ? () => setScheduledPanelOpen((open) => !open) : undefined}
            />
            {pinnedMessageId && (
              <div className="pinned-message-bar" onClick={() => {
                onJumpToMessage(pinnedMessageId)
              }}>
                <Pin size={14} className="pinned-icon" />
                <span className="pinned-text">
                  {pinnedMessage ? (pinnedMessage.text || t('chat.mediaMessage')) : t('chat.pinnedMessage')}
                </span>
                <button
                  className="pinned-close"
                  onClick={(event) => {
                    event.stopPropagation()
                    onPinMessage(null)
                  }}
                  aria-label={t('chat.unpinMessage')}
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
              onOpenMedia={openMediaViewer}
              onDownloadMedia={startDownload}
              onForwardMessage={setForwardMessage}
              onPinMessage={onPinMessage}
              onRetryMessage={onRetryMessage}
              onReportMessage={onReportMessage}
              onVotePoll={onVotePoll}
              typingUsers={typingUsers}
              unreadFromId={unreadFromId}
            />
            {multiSelectMode ? (
              <div className="multiselect-bar">
                <button onClick={onClearMessageSelection} className="multiselect-cancel">
                  <X size={16} /> {t('chat.cancel')}
                </button>
                <span>{t('chat.selectedCount', { count: selectedMessageIds.size })}</span>
                <div className="multiselect-actions">
                  <button
                    onClick={() => {
                      setForwardingSelected(true)
                      setForwardMessage({ _multi: true })
                    }}
                  >
                    {t('chat.forward')}
                  </button>
                  <button className="danger" onClick={onDeleteSelectedMessages}>
                    {t('chat.delete')}
                  </button>
                </div>
              </div>
            ) : privateBlocked ? (
              <div className="blocked-chat-bar">
                <span>
                  {blockedByMe ? t('chat.blockedByYou') : t('chat.userUnavailable')}
                </span>
                {blockedByMe && (
                  <button type="button" onClick={() => onUnblockUser(selectedContact.id)}>
                    {t('chat.unblock')}
                  </button>
                )}
              </div>
            ) : (
              <Composer
                key={`${selectedChat.id}-${editingMessage?.id || 'compose'}`}
                chatId={selectedChat.id}
                replyTo={replyTo}
                editingMessage={editingMessage}
                onSend={onSendMessage}
                onScheduleSend={selectedChat.backend ? onScheduleSend : undefined}
                onSendAttachment={onSendAttachment}
                onSendAttachments={onSendAttachments}
                onSendRichMessage={onSendRichMessage}
                onTyping={onTyping}
                onCancelReply={onCancelReply}
                onCancelEdit={onCancelEdit}
                onAttach={(message) => onUpdateSettings({ toast: message })}
                currentUser={user}
              />
            )}
          </>
        ) : (
          <section className="empty-chat">
            <div className="empty-mark"><span>✦</span></div>
            <h1>Onda</h1>
            <p>{t('chat.emptySubtitle')}</p>
            <button className="primary-button" onClick={onOpenContacts}>
              {t('chat.newChat')}
            </button>
          </section>
        )}
      </main>

      {ui.searchOpen && hasChat && (
        <SearchPanel
          query={messageSearch}
          messages={messages}
          contact={selectedContact}
          contacts={contacts}
          currentUser={user}
          onQuery={onMessageSearch}
          onClose={onToggleSearch}
          chat={selectedChat}
          onSelect={onJumpToMessage}
        />
      )}

      {globalSearchOpen && (
        <GlobalSearchPanel
          contacts={contacts}
          onClose={() => setGlobalSearchOpen(false)}
          onSelectChat={onGlobalSearchSelectChat}
          onJumpToMessage={onGlobalSearchJumpMessage}
        />
      )}

      {ui.profileOpen && hasChat && (
        <ProfilePanel
          contact={selectedContact}
          chat={selectedChat}
          contacts={contacts}
          messages={messages}
          currentUserId={user.id}
          onClose={onCloseProfile}
          onTogglePin={() => onTogglePin(selectedChat.id)}
          onToggleMute={() => onToggleMute(selectedChat.id)}
          onArchive={() => onArchiveChat(selectedChat.id)}
          onOpenMedia={(media) => setOpenMedia({ media, items: [media], index: 0 })}
          onLoadGroupMembers={onLoadGroupMembers}
          onLoadCallHistory={onLoadCallHistory}
          onAddGroupMember={onAddGroupMember}
          onRemoveGroupMember={onRemoveGroupMember}
          onUpdateGroupInfo={onUpdateGroupInfo}
          onUpdateGroupMemberRole={onUpdateGroupMemberRole}
          onUpdateGroupMemberPermissions={onUpdateGroupMemberPermissions}
          onBlockUser={onBlockUser}
          onUnblockUser={onUnblockUser}
          onReportUser={(userId) => onReportUser(userId, { chatId: selectedChat.id })}
        />
      )}

      {scheduledPanelOpen && selectedChat?.backend && (
        <ScheduledPanel
          chatId={selectedChat.id}
          onClose={() => setScheduledPanelOpen(false)}
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
          remoteStreams={callController.remoteStreams}
          connectionStats={callController.connectionStats}
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
      <MediaViewer
        key={openMedia?.media?.id || openMedia?.media?.url || 'media-viewer'}
        media={openMedia?.media}
        items={openMedia?.items || []}
        initialIndex={openMedia?.index || 0}
        onClose={() => setOpenMedia(null)}
        onDownload={startDownload}
      />
      <DownloadManager
        downloads={downloads}
        onCancel={cancelDownload}
        onRetry={retryDownload}
        onClear={() => setDownloads((current) => Object.fromEntries(
          Object.entries(current).filter(([, item]) => item.status === 'downloading'),
        ))}
      />
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
