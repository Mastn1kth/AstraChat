export const DEFAULT_WORD_STREAM_SETTINGS = {
  enabled: false,
  speed: 1,
  density: 6,
  opacity: 0.13,
  blur: 0,
}

const sensitiveWords = new Set([
  'address',
  'адрес',
  'bank',
  'банк',
  'card',
  'карта',
  'code',
  'код',
  'email',
  'почта',
  'login',
  'логин',
  'passport',
  'паспорт',
  'password',
  'пароль',
  'phone',
  'телефон',
  'pin',
  'secret',
  'секрет',
  'token',
  'токен',
])

function addBlockedWords(target, value) {
  if (!value) return
  const words = String(value).toLocaleLowerCase().match(/\p{L}{2,}/gu) || []
  words.forEach((word) => target.add(word))
}

function removeSensitiveFragments(text) {
  return text
    .replace(/https?:\/\/\S+|www\.\S+/giu, ' ')
    .replace(/\b[\p{L}\d._%+-]+@[\p{L}\d.-]+\.[\p{L}]{2,}\b/giu, ' ')
    .replace(/(^|\s)@[\p{L}\d_]+/giu, ' ')
    .replace(/\+?\d[\d\s().-]{5,}\d/gu, ' ')
    .replace(/\b[\p{L}\d_-]*\d[\p{L}\d_-]*\b/giu, ' ')
}

export function extractPrivateWordStream({ messages, currentUser, contacts }) {
  const blockedWords = new Set(sensitiveWords)

  addBlockedWords(blockedWords, currentUser?.name)
  addBlockedWords(blockedWords, currentUser?.username)

  contacts.forEach((contact) => {
    addBlockedWords(blockedWords, contact.name)
    addBlockedWords(blockedWords, contact.username)
  })

  const frequencies = new Map()

  Object.values(messages).flat().forEach((message) => {
    if (
      message.senderId !== currentUser?.id ||
      message.deleted ||
      typeof message.text !== 'string'
    ) {
      return
    }

    const safeText = removeSensitiveFragments(message.text)
    const tokens = safeText.match(/\p{L}[\p{L}'’-]{2,19}/gu) || []

    tokens.forEach((token) => {
      const normalized = token
        .toLocaleLowerCase()
        .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '')

      if (
        normalized.length < 3 ||
        blockedWords.has(normalized) ||
        sensitiveWords.has(normalized)
      ) {
        return
      }

      frequencies.set(normalized, (frequencies.get(normalized) || 0) + 1)
    })
  })

  return [...frequencies.entries()]
    .sort((first, second) => second[1] - first[1] || first[0].localeCompare(second[0]))
    .slice(0, 60)
    .map(([word]) => word)
}
