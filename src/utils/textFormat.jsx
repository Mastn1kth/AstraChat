import { useState } from 'react'

/**
 * Parses markdown-like inline formatting from a string.
 * Supported: **bold**, _italic_, `code`, ||spoiler||
 * Returns an array of token objects: { type, content }
 */
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

function renderTokens(tokens, keyPrefix = '') {
  return tokens.map((token, i) => {
    const key = `${keyPrefix}${i}`
    switch (token.type) {
      case 'bold':    return <strong key={key}>{token.content}</strong>
      case 'italic':  return <em key={key}>{token.content}</em>
      case 'code':    return <code key={key} className="inline-code">{token.content}</code>
      case 'spoiler': return <SpoilerSpan key={key} content={token.content} />
      default:        return <span key={key}>{token.content}</span>
    }
  })
}

/**
 * Renders a formatted message text string as React elements.
 * Lines starting with "> " are rendered as blockquotes.
 */
export default function FormattedText({ text }) {
  if (!text) return null

  const lines = text.split('\n')

  return (
    <>
      {lines.map((line, lineIndex) => {
        const isLast = lineIndex === lines.length - 1
        const isQuote = line.startsWith('> ') || (line.startsWith('>') && line.length > 1)
        const content = isQuote ? line.slice(line.startsWith('> ') ? 2 : 1) : line
        const tokens = parseInline(content)
        const rendered = renderTokens(tokens, `${lineIndex}-`)

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
