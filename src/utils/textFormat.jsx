import { useState } from 'react'

const URL_RE = /https?:\/\/[^\s<>"']+/g
const MENTION_RE = /@[\w.]+/g

import { getCustomEmojiUrl } from './customEmojiStore'

function parseInline(text) {
  const tokens = []
  let i = 0
  const len = text.length

  function pushText(char) {
    if (tokens.length > 0 && tokens[tokens.length - 1].type === 'text') {
      tokens[tokens.length - 1].content += char
    } else {
      tokens.push({ type: 'text', content: char })
    }
  }

  while (i < len) {
    // Custom emoji: :shortcode:
    if (text[i] === ':') {
      const end = text.indexOf(':', i + 1)
      if (end > i + 1) {
        const shortcode = text.slice(i + 1, end)
        const ceUrl = /^\w+$/.test(shortcode) && getCustomEmojiUrl(shortcode)
        if (ceUrl) {
          tokens.push({ type: 'custom-emoji', shortcode, url: ceUrl })
          i = end + 1
          continue
        }
      }
    }
    // Bold: **text**
    if (text[i] === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2)
      if (end > i + 2) {
        tokens.push({ type: 'bold', content: text.slice(i + 2, end) })
        i = end + 2
        continue
      }
    }
    // Italic: _text_ (not __)
    if (text[i] === '_' && text[i + 1] !== '_') {
      const end = text.indexOf('_', i + 1)
      if (end > i + 1 && text[end + 1] !== '_') {
        tokens.push({ type: 'italic', content: text.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }
    // Code: `text`
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1)
      if (end > i + 1) {
        tokens.push({ type: 'code', content: text.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }
    // Spoiler: ||text||
    if (text[i] === '|' && text[i + 1] === '|') {
      const end = text.indexOf('||', i + 2)
      if (end > i + 2) {
        tokens.push({ type: 'spoiler', content: text.slice(i + 2, end) })
        i = end + 2
        continue
      }
    }
    pushText(text[i])
    i++
  }

  return tokens
}

// Split a plain-text token into url/mention/text sub-tokens
function splitTextToken(content) {
  const result = []
  let lastIndex = 0

  const combined = new RegExp(`${URL_RE.source}|${MENTION_RE.source}`, 'g')
  let match
  while ((match = combined.exec(content)) !== null) {
    if (match.index > lastIndex) {
      result.push({ type: 'text', content: content.slice(lastIndex, match.index) })
    }
    const value = match[0]
    if (value.startsWith('http')) {
      result.push({ type: 'url', content: value })
    } else {
      result.push({ type: 'mention', content: value })
    }
    lastIndex = match.index + value.length
  }
  if (lastIndex < content.length) {
    result.push({ type: 'text', content: content.slice(lastIndex) })
  }
  return result.length ? result : [{ type: 'text', content }]
}

function SpoilerSpan({ content }) {
  const [revealed, setRevealed] = useState(false)
  return (
    <span
      className={`spoiler-text${revealed ? ' revealed' : ''}`}
      onClick={(e) => { e.stopPropagation(); setRevealed(true) }}
      title={revealed ? '' : 'Click to reveal'}
    >
      {content}
    </span>
  )
}

function renderTokens(tokens, keyPrefix = '', currentUsername) {
  return tokens.flatMap((token, i) => {
    const key = `${keyPrefix}${i}`
    switch (token.type) {
      case 'custom-emoji': return [<img key={key} src={token.url} alt={`:${token.shortcode}:`} title={token.shortcode} className="custom-emoji-inline" />]
      case 'bold':    return [<strong key={key}>{token.content}</strong>]
      case 'italic':  return [<em key={key}>{token.content}</em>]
      case 'code':    return [<code key={key} className="inline-code">{token.content}</code>]
      case 'spoiler': return [<SpoilerSpan key={key} content={token.content} />]
      case 'text': {
        const sub = splitTextToken(token.content)
        return sub.map((s, j) => {
          const sk = `${key}-${j}`
          if (s.type === 'url') {
            return <a key={sk} href={s.content} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{s.content}</a>
          }
          if (s.type === 'mention') {
            const handle = s.content.slice(1).toLowerCase()
            const isSelf = currentUsername && handle === currentUsername.replace(/^@/, '').toLowerCase()
            return <span key={sk} className={`mention-inline${isSelf ? ' mention-self' : ''}`}>{s.content}</span>
          }
          return <span key={sk}>{s.content}</span>
        })
      }
      default: return [<span key={key}>{token.content}</span>]
    }
  })
}

export default function FormattedText({ text, currentUsername }) {
  if (!text) return null

  const lines = text.split('\n')

  return (
    <>
      {lines.map((line, lineIndex) => {
        const isLast = lineIndex === lines.length - 1
        const isQuote = line.startsWith('> ') || (line.startsWith('>') && line.length > 1)
        const content = isQuote ? line.slice(line.startsWith('> ') ? 2 : 1) : line
        const tokens = parseInline(content)
        const rendered = renderTokens(tokens, `${lineIndex}-`, currentUsername)

        if (isQuote) {
          return (
            <span key={lineIndex}>
              <blockquote className="message-quote">{rendered}</blockquote>
            </span>
          )
        }

        return (
          <span key={lineIndex}>
            {rendered}
            {!isLast && <br />}
          </span>
        )
      })}
    </>
  )
}
