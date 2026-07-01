export const RICH_MESSAGE_PREFIX = 'astra:rich:v1:'

export const stickerPacks = [
  {
    id: 'launch',
    title: 'Launch',
    icon: '🚀',
    stickers: [
      { id: 'ship', emoji: '🚀', title: 'Ship it' },
      { id: 'ok', emoji: '👌', title: 'OK' },
      { id: 'done', emoji: '✅', title: 'Done' },
      { id: 'fire', emoji: '🔥', title: 'Hot' },
      { id: 'eyes', emoji: '👀', title: 'Looking' },
      { id: 'clap', emoji: '👏', title: 'Nice' },
      { id: 'think', emoji: '🤔', title: 'Hmm' },
      { id: '100', emoji: '💯', title: 'Perfect' },
    ],
  },
  {
    id: 'vibes',
    title: 'Vibes',
    icon: '🌊',
    stickers: [
      { id: 'wave', emoji: '🌊', title: 'Wave', lottieUrl: '/stickers/wave.json' },
      { id: 'sun', emoji: '☀️', title: 'Sunny' },
      { id: 'moon', emoji: '🌙', title: 'Night' },
      { id: 'star', emoji: '⭐', title: 'Star' },
      { id: 'sparkles', emoji: '✨', title: 'Magic' },
      { id: 'rainbow', emoji: '🌈', title: 'Rainbow' },
      { id: 'flower', emoji: '🌸', title: 'Bloom' },
      { id: 'leaf', emoji: '🍃', title: 'Fresh' },
    ],
  },
  {
    id: 'feels',
    title: 'Feels',
    icon: '😊',
    stickers: [
      { id: 'smile', emoji: '😊', title: 'Happy' },
      { id: 'laugh', emoji: '😂', title: 'Lol' },
      { id: 'love', emoji: '🥰', title: 'Love' },
      { id: 'cry', emoji: '😢', title: 'Sad' },
      { id: 'angry', emoji: '😤', title: 'Angry' },
      { id: 'cool', emoji: '😎', title: 'Cool' },
      { id: 'nervous', emoji: '😬', title: 'Nervous' },
      { id: 'sleep', emoji: '😴', title: 'Sleepy' },
    ],
  },
  {
    id: 'work',
    title: 'Work',
    icon: '💼',
    stickers: [
      { id: 'laptop', emoji: '💻', title: 'Working' },
      { id: 'coffee', emoji: '☕', title: 'Coffee' },
      { id: 'meeting', emoji: '📅', title: 'Meeting' },
      { id: 'chart', emoji: '📈', title: 'Growing' },
      { id: 'deadline', emoji: '⏰', title: 'Deadline' },
      { id: 'idea', emoji: '💡', title: 'Idea' },
      { id: 'bug', emoji: '🐛', title: 'Bug' },
      { id: 'deploy', emoji: '🎯', title: 'Deploy' },
    ],
  },
]

export const gifSet = [
  { id: 'applause', title: 'Applause', frames: ['👏', '✨', '👏'], tone: '#0ea5e9' },
  { id: 'typing', title: 'Typing fast', frames: ['⌨️', '…', '↵'], tone: '#7c3aed' },
  { id: 'celebrate', title: 'Celebration', frames: ['🎉', '🥳', '✨'], tone: '#f97316' },
]

export const customEmojiSet = [
  { id: 'astra', value: '✦', title: 'Astra' },
  { id: 'verified', value: '✓', title: 'Verified' },
  { id: 'priority', value: '◆', title: 'Priority' },
  { id: 'spark', value: '✧', title: 'Spark' },
]

export function encodeRichMessage(payload) {
  return `${RICH_MESSAGE_PREFIX}${JSON.stringify(payload)}`
}

export function decodeRichMessage(text) {
  if (!String(text || '').startsWith(RICH_MESSAGE_PREFIX)) {
    return { text: text || '', rich: null }
  }

  try {
    const rich = JSON.parse(String(text).slice(RICH_MESSAGE_PREFIX.length))
    return {
      text: rich.caption || rich.text || '',
      rich,
    }
  } catch {
    return { text: text || '', rich: null }
  }
}

export function getRichSearchText(rich) {
  if (!rich) return ''
  if (rich.type === 'sticker') return `sticker ${rich.title || rich.emoji || ''}`.trim()
  if (rich.type === 'gif') return `gif ${rich.title || ''}`.trim()
  if (rich.type === 'location') return `location ${rich.title || ''}`.trim()
  if (rich.type === 'live_location') return `live location ${rich.title || ''}`.trim()
  if (rich.type === 'contact') return `contact ${rich.name || rich.username || ''}`.trim()
  if (rich.type === 'album') return rich.caption || 'album'
  return rich.caption || rich.text || rich.type || ''
}

export function getMessagePlainText(message) {
  if (message?.rich) return getRichSearchText(message.rich)
  return message?.text || ''
}

export function getMessagePreview(message) {
  if (!message) return 'Message'
  if (message.deleted) return 'Message deleted'
  if (message.rich?.type === 'sticker') return `${message.rich.emoji || 'Sticker'} ${message.rich.title || 'Sticker'}`
  if (message.rich?.type === 'gif') return `GIF: ${message.rich.title || 'animation'}`
  if (message.rich?.type === 'location') return message.rich.title || 'Location'
  if (message.rich?.type === 'live_location') return message.rich.title || 'Live location'
  if (message.rich?.type === 'contact') return `Contact: ${message.rich.name || message.rich.username || 'card'}`
  if (message.rich?.type === 'album') return message.rich.caption || 'Album'
  if (message.text) return message.text
  if (message.media) return `${message.media.kind || 'Media'} message`
  return 'Message'
}
