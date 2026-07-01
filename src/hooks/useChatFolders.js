import { useState } from 'react'
import {
  createChatFolder,
  deleteChatFolder,
  updateChatFolder,
  updateChatFolderChat,
} from '../api/client'

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

export default function useChatFolders({ chatFolders, setChatFolders, showToast }) {
  const [selectedFolderId, setSelectedFolderId] = useState('all')

  function upsertChatFolder(folder) {
    setChatFolders((current) => {
      const normalized = normalizeChatFolders({ ...current, folders: [folder] }).folders[0]
      return {
        ...(current || EMPTY_CHAT_FOLDERS),
        folders: (current?.folders || []).some((item) => item.id === normalized.id)
          ? current.folders.map((item) => (item.id === normalized.id ? normalized : item))
          : [...(current?.folders || []), normalized],
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
    const snapshot = chatFolders
    try {
      const { folder } = await updateChatFolder(folderId, input)
      setChatFolders((current) => {
        const existing = current?.folders?.find((item) => item.id === folderId)
        const nextFolder = {
          ...existing,
          ...folder,
          chats: folder.chats || existing?.chats || [],
        }
        return {
          ...(current || EMPTY_CHAT_FOLDERS),
          folders: (current?.folders || []).map((item) =>
            item.id === folderId ? normalizeChatFolders({ folders: [nextFolder] }).folders[0] : item,
          ),
        }
      })
      showToast('Folder saved.')
      return folder
    } catch (error) {
      setChatFolders(snapshot)
      throw error
    }
  }

  async function removeFolder(folderId) {
    const snapshot = chatFolders
    setChatFolders((current) => ({
      ...(current || EMPTY_CHAT_FOLDERS),
      folders: (current?.folders || []).filter((folder) => folder.id !== folderId),
    }))
    if (selectedFolderId === folderId) setSelectedFolderId('all')
    try {
      await deleteChatFolder(folderId)
      showToast('Folder deleted.')
    } catch (error) {
      setChatFolders(snapshot)
      throw error
    }
  }

  async function toggleFolderChatPin(folderId, chatId) {
    const folder = chatFolders?.folders?.find((item) => item.id === folderId)
    const folderChat = folder?.chats?.find((item) => item.chatId === chatId)
    if (!folder || !folderChat) return
    const nextPinned = !folderChat.pinned
    const now = new Date().toISOString()
    const snapshot = chatFolders
    setChatFolders((current) => ({
      ...(current || EMPTY_CHAT_FOLDERS),
      folders: (current?.folders || []).map((item) =>
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
    }))
    try {
      const { chat } = await updateChatFolderChat(folderId, chatId, { pinned: nextPinned })
      setChatFolders((current) => ({
        ...(current || EMPTY_CHAT_FOLDERS),
        folders: (current?.folders || []).map((item) =>
          item.id === folderId
            ? {
                ...item,
                chats: item.chats.map((folderChat) =>
                  folderChat.chatId === chatId ? { ...folderChat, ...chat } : folderChat,
                ),
              }
            : item,
        ),
      }))
    } catch (error) {
      setChatFolders(snapshot)
      showToast(error.message || 'Folder pin was not saved.')
    }
  }

  return {
    selectedFolderId,
    setSelectedFolderId,
    createFolder,
    saveFolder,
    removeFolder,
    toggleFolderChatPin,
  }
}

export { SYSTEM_CHAT_FOLDERS, EMPTY_CHAT_FOLDERS, normalizeChatFolders }
