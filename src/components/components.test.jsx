import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Pin } from 'lucide-react'
import AuthScreen from './AuthScreen'
import ChatItem from './ChatItem'
import Composer from './Composer'
import IconButton from './IconButton'
import MessageBubble from './MessageBubble'
import RichMessage from './RichMessage'
import { stickerPacks } from '../utils/richMessages'
import { LANGUAGES, DICT } from '../i18n'

describe('React components', () => {
  it('renders Lottie stickers with an animation container', () => {
    const html = renderToStaticMarkup(
      <RichMessage rich={{
        type: 'sticker',
        title: 'Animated wave',
        emoji: '👋',
        lottieUrl: '/stickers/wave.json',
      }}
      />,
    )

    expect(html).toContain('rich-sticker animated')
    expect(html).toContain('data-lottie-src="/stickers/wave.json"')
    expect(html).toContain('Animated wave')
  })

  it('ships at least one built-in Lottie sticker', () => {
    const stickers = stickerPacks.flatMap((pack) => pack.stickers)

    expect(stickers.some((sticker) => sticker.lottieUrl)).toBe(true)
  })

  it('renders the auth screen entry step with primary actions', () => {
    const html = renderToStaticMarkup(
      <AuthScreen
        pending={false}
        error=""
        onLogin={vi.fn()}
        onRegister={vi.fn()}
        onPhoneStart={vi.fn()}
        onPhoneVerify={vi.fn()}
      />,
    )

    expect(html).toContain('Onda')
    expect(html).toContain('astra-form')
    expect(html).toContain('autoComplete="tel"')
    expect(html).toContain('Отправить код')
  })

  it('renders chat state badges and unread count', () => {
    const html = renderToStaticMarkup(
      <ChatItem
        selected
        canPinInFolder
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        onToggleMute={vi.fn()}
        onArchive={vi.fn()}
        onToggleFolderPin={vi.fn()}
        chat={{
          pinned: true,
          muted: true,
          archived: false,
          folderPinned: true,
          unread: 3,
          lastMessageText: 'Latest message',
          lastMessageTime: '2026-06-08T10:00:00Z',
          contact: {
            id: 'not-a-uuid',
            type: 'group',
            name: 'Project Group',
            avatar: 'PG',
            color: '#123456',
            status: 'online',
            lastSeen: 'online',
          },
        }}
      />,
    )

    expect(html).toContain('chat-item selected')
    expect(html).toContain('Project Group')
    expect(html).toContain('type-badge type-group')
    expect(html).toContain('unread-badge')
    expect(html).toContain('Latest message')
  })

  it('renders accessible icon buttons', () => {
    const html = renderToStaticMarkup(
      <IconButton label="Pin chat">
        <Pin size={16} />
      </IconButton>,
    )

    expect(html).toContain('aria-label="Pin chat"')
    expect(html).toContain('title="Pin chat"')
    expect(html).toContain('icon-button')
  })

  it('renders message states for deleted and selected messages', () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        message={{
          id: 'message-1',
          text: 'Secret text',
          time: '2026-06-08T10:15:00Z',
          status: 'sent',
          deleted: true,
          reactions: { '\u{1F44D}': 2 },
        }}
        sender={{ id: 'user-1', name: 'Alice' }}
        isOwn
        selected
        matched={false}
        highlighted={false}
        multiSelectMode={false}
        multiSelected={false}
        onSelect={vi.fn()}
        onStartReply={vi.fn()}
        onStartEdit={vi.fn()}
        onDelete={vi.fn()}
        onCopy={vi.fn()}
        onReact={vi.fn()}
        onOpenMedia={vi.fn()}
        onForward={vi.fn()}
        onToggleSelect={vi.fn()}
      />,
    )

    expect(html).toContain('message-row own selected')
    expect(html).toContain('Message deleted')
    expect(html).toContain('reaction-strip align-right')
    expect(html).not.toContain('Secret text')
  })

  // ── Read-by / seen-by ──────────────────────────────────────

  it('shows seen-by count for own messages in group chats', () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        message={{
          id: 'msg-seen-1',
          text: 'Hello group',
          time: '2026-06-10T10:00:00Z',
          status: 'read',
          readBy: [
            { userId: 'user-2', name: 'Bob', username: 'bob' },
            { userId: 'user-3', name: 'Carol', username: 'carol' },
          ],
        }}
        sender={{ id: 'user-1', name: 'Alice' }}
        isOwn
        contactType="group"
        matched={false}
        highlighted={false}
        multiSelectMode={false}
        multiSelected={false}
        onSelect={vi.fn()}
        onStartReply={vi.fn()}
        onStartEdit={vi.fn()}
        onDelete={vi.fn()}
        onCopy={vi.fn()}
        onReact={vi.fn()}
        onOpenMedia={vi.fn()}
        onForward={vi.fn()}
        onToggleSelect={vi.fn()}
      />,
    )

    expect(html).toContain('seen-by')
    expect(html).toContain('Seen by 2')
    expect(html).toContain('title="Bob, Carol"')
  })

  it('shows seen-by for a single reader in groups', () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        message={{
          id: 'msg-seen-2',
          text: 'Single reader',
          time: '2026-06-10T10:00:00Z',
          status: 'read',
          readBy: [{ userId: 'user-2', name: 'Bob', username: 'bob' }],
        }}
        sender={{ id: 'user-1', name: 'Alice' }}
        isOwn
        contactType="group"
        matched={false}
        highlighted={false}
        multiSelectMode={false}
        multiSelected={false}
        onSelect={vi.fn()}
        onStartReply={vi.fn()}
        onStartEdit={vi.fn()}
        onDelete={vi.fn()}
        onCopy={vi.fn()}
        onReact={vi.fn()}
        onOpenMedia={vi.fn()}
        onForward={vi.fn()}
        onToggleSelect={vi.fn()}
      />,
    )

    expect(html).toContain('Seen by 1')
    expect(html).toContain('title="Bob"')
  })

  it('does not show seen-by for own messages in private chats', () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        message={{
          id: 'msg-private',
          text: 'Hey',
          time: '2026-06-10T10:00:00Z',
          status: 'read',
          readBy: [{ userId: 'user-2', name: 'Bob', username: 'bob' }],
        }}
        sender={{ id: 'user-1', name: 'Alice' }}
        isOwn
        contactType="private"
        matched={false}
        highlighted={false}
        multiSelectMode={false}
        multiSelected={false}
        onSelect={vi.fn()}
        onStartReply={vi.fn()}
        onStartEdit={vi.fn()}
        onDelete={vi.fn()}
        onCopy={vi.fn()}
        onReact={vi.fn()}
        onOpenMedia={vi.fn()}
        onForward={vi.fn()}
        onToggleSelect={vi.fn()}
      />,
    )

    expect(html).not.toContain('Seen by')
  })

  it('does not show seen-by for incoming (not own) messages in groups', () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        message={{
          id: 'msg-incoming',
          text: 'Hello',
          time: '2026-06-10T10:00:00Z',
          status: 'read',
          readBy: [{ userId: 'user-1', name: 'Alice', username: 'alice' }],
        }}
        sender={{ id: 'user-2', name: 'Bob' }}
        isOwn={false}
        contactType="group"
        matched={false}
        highlighted={false}
        multiSelectMode={false}
        multiSelected={false}
        onSelect={vi.fn()}
        onStartReply={vi.fn()}
        onStartEdit={vi.fn()}
        onDelete={vi.fn()}
        onCopy={vi.fn()}
        onReact={vi.fn()}
        onOpenMedia={vi.fn()}
        onForward={vi.fn()}
        onToggleSelect={vi.fn()}
      />,
    )

    expect(html).not.toContain('Seen by')
  })

  it('does not show seen-by when readBy is empty', () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        message={{
          id: 'msg-no-reads',
          text: 'No one read yet',
          time: '2026-06-10T10:00:00Z',
          status: 'sent',
          readBy: [],
        }}
        sender={{ id: 'user-1', name: 'Alice' }}
        isOwn
        contactType="group"
        matched={false}
        highlighted={false}
        multiSelectMode={false}
        multiSelected={false}
        onSelect={vi.fn()}
        onStartReply={vi.fn()}
        onStartEdit={vi.fn()}
        onDelete={vi.fn()}
        onCopy={vi.fn()}
        onReact={vi.fn()}
        onOpenMedia={vi.fn()}
        onForward={vi.fn()}
        onToggleSelect={vi.fn()}
      />,
    )

    expect(html).not.toContain('Seen by')
  })

  it('does not show seen-by when readBy is undefined', () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        message={{
          id: 'msg-no-reads-2',
          text: 'No one read yet',
          time: '2026-06-10T10:00:00Z',
          status: 'sent',
        }}
        sender={{ id: 'user-1', name: 'Alice' }}
        isOwn
        contactType="group"
        matched={false}
        highlighted={false}
        multiSelectMode={false}
        multiSelected={false}
        onSelect={vi.fn()}
        onStartReply={vi.fn()}
        onStartEdit={vi.fn()}
        onDelete={vi.fn()}
        onCopy={vi.fn()}
        onReact={vi.fn()}
        onOpenMedia={vi.fn()}
        onForward={vi.fn()}
        onToggleSelect={vi.fn()}
      />,
    )

    expect(html).not.toContain('Seen by')
  })

  it('shows status icon (double-check) alongside seen-by for read messages', () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        message={{
          id: 'msg-seen-status',
          text: 'Read message',
          time: '2026-06-10T10:00:00Z',
          status: 'read',
          readBy: [{ userId: 'user-2', name: 'Bob', username: 'bob' }],
        }}
        sender={{ id: 'user-1', name: 'Alice' }}
        isOwn
        contactType="group"
        matched={false}
        highlighted={false}
        multiSelectMode={false}
        multiSelected={false}
        onSelect={vi.fn()}
        onStartReply={vi.fn()}
        onStartEdit={vi.fn()}
        onDelete={vi.fn()}
        onCopy={vi.fn()}
        onReact={vi.fn()}
        onOpenMedia={vi.fn()}
        onForward={vi.fn()}
        onToggleSelect={vi.fn()}
      />,
    )

    expect(html).toContain('read-check')
    expect(html).toContain('Seen by 1')
  })

  // ── Forward compose preview ────────────────────────────────

  it('shows forwarding preview bar in composer when forwardSource is set', () => {
    const html = renderToStaticMarkup(
      <Composer
        chatId="chat-1"
        forwardSource={{ id: 'msg-1', text: 'Original forwarded text' }}
        onCancelForward={vi.fn()}
        onSend={vi.fn()}
        onTyping={vi.fn()}
        currentUser={{ id: 'user-1', name: 'Alice' }}
      />,
    )

    expect(html).toContain('composer-preview')
    expect(html).toContain('Original forwarded text')
  })

  it('shows forwarding preview with empty text for rich messages', () => {
    const html = renderToStaticMarkup(
      <Composer
        chatId="chat-2"
        forwardSource={{ id: 'msg-2', text: '' }}
        onCancelForward={vi.fn()}
        onSend={vi.fn()}
        onTyping={vi.fn()}
        currentUser={{ id: 'user-1', name: 'Alice' }}
      />,
    )

    expect(html).toContain('composer-preview')
  })

  it('does not show forwarding bar when forwardSource is null', () => {
    const html = renderToStaticMarkup(
      <Composer
        chatId="chat-3"
        forwardSource={null}
        onSend={vi.fn()}
        onTyping={vi.fn()}
        currentUser={{ id: 'user-1', name: 'Alice' }}
      />,
    )

    expect(html).not.toContain('composer-preview')
  })
})

describe('i18n locales', () => {
  it('LANGUAGES entries have matching DICT tables', () => {
    for (const { id } of LANGUAGES) {
      expect(DICT[id]).toBeTruthy()
    }
  })

  it('every locale has the exact same key set as en', () => {
    const enKeys = Object.keys(DICT.en).sort()

    for (const { id } of LANGUAGES) {
      const keys = Object.keys(DICT[id]).sort()
      expect(keys).toEqual(enKeys)
    }
  })

  it('every locale keeps the same {placeholder} tokens as en', () => {
    const placeholderTokens = (str) => (str.match(/\{[a-zA-Z]+\}/g) || []).sort().join(',')

    for (const { id } of LANGUAGES) {
      if (id === 'en') continue
      for (const key of Object.keys(DICT.en)) {
        expect(placeholderTokens(DICT[id][key])).toBe(placeholderTokens(DICT.en[key]))
      }
    }
  })
})
