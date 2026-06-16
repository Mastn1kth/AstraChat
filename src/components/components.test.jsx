import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Pin } from 'lucide-react'
import AuthScreen from './AuthScreen'
import ChatItem from './ChatItem'
import IconButton from './IconButton'
import MessageBubble from './MessageBubble'

describe('React components', () => {
  it('renders the auth screen entry step with primary actions', () => {
    const html = renderToStaticMarkup(
      <AuthScreen
        pending={false}
        error=""
        onLogin={vi.fn()}
        onRegister={vi.fn()}
        onTestLogin={vi.fn()}
      />,
    )

    expect(html).toContain('Onda')
    expect(html).toContain('astra-form')
    expect(html).toContain('autoComplete="username"')
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
})
