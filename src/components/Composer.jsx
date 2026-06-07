import { useCallback, useEffect, useRef, useState } from 'react'
import { Bold, Code, FileText, FileVideo2, Image, Italic, LoaderCircle, Mic, Music, Paperclip, Send, Smile, Strikethrough, Trash2, X } from 'lucide-react'
import IconButton from './IconButton'

const emojiSet = [
  '\u{1F600}', '\u{1F603}', '\u{1F604}', '\u{1F601}', '\u{1F606}', '\u{1F605}', '\u{1F923}', '\u{1F602}',
  '\u{1F642}', '\u{1F609}', '\u{1F60A}', '\u{1F607}', '\u{1F970}', '\u{1F60D}', '\u{1F618}', '\u{1F617}',
  '\u{1F60B}', '\u{1F61B}', '\u{1F61C}', '\u{1F92A}', '\u{1F60E}', '\u{1F913}', '\u{1F914}', '\u{1F910}',
  '\u{1F610}', '\u{1F611}', '\u{1F636}', '\u{1F644}', '\u{1F60F}', '\u{1F62C}', '\u{1F633}', '\u{1F97A}',
  '\u{1F622}', '\u{1F62D}', '\u{1F624}', '\u{1F620}', '\u{1F621}', '\u{1F92C}', '\u{1F614}', '\u{1F615}',
  '\u{1F44D}', '\u{1F44E}', '\u{1F44C}', '\u{270C}', '\u{1F91E}', '\u{1F44F}', '\u{1F64C}', '\u{1F64F}',
  '\u{1F4AA}', '\u{1F525}', '\u{2728}', '\u{1F389}', '\u{1F4AF}', '\u{2705}', '\u{274C}', '\u{2764}',
  '\u{1F9E1}', '\u{1F49B}', '\u{1F49A}', '\u{1F499}', '\u{1F49C}', '\u{1F5A4}', '\u{1F90D}', '\u{1F3AF}',
]
const stickers = ['STK: Launch', 'STK: OK', 'STK: Ship']
const gifs = ['GIF: applause', 'GIF: typing', 'GIF: celebration']

const DRAFT_PREFIX = 'astrachat.draft.'

function getSupportedAudioMimeType() {
  if (!window.MediaRecorder) return ''
  return [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ].find((type) => window.MediaRecorder.isTypeSupported(type)) || ''
}

function formatRecordTime(seconds) {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`
}

function attachmentKind(file) {
  if (file.type.startsWith('image/')) return 'Photo'
  if (file.type.startsWith('video/')) return 'Video'
  if (file.type.startsWith('audio/')) return 'Audio'
  return 'File'
}

export default function Composer({
  chatId,
  replyTo,
  editingMessage,
  onSend,
  onCancelReply,
  onCancelEdit,
  onAttach,
  onSendAttachment,
  onTyping,
  onMockSend,
}) {
  const draftKey = chatId ? `${DRAFT_PREFIX}${chatId}` : ''
  const [value, setValue] = useState(() => {
    if (editingMessage) return editingMessage.text || ''
    if (!draftKey) return ''
    try {
      return globalThis.localStorage?.getItem(draftKey) || ''
    } catch {
      return ''
    }
  })
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [panelTab, setPanelTab] = useState('emoji')
  const [attachment, setAttachment] = useState(null)
  const [sending, setSending] = useState(false)
  const [recording, setRecording] = useState(false)
  const [recordSeconds, setRecordSeconds] = useState(0)
  const [formatBarOpen, setFormatBarOpen] = useState(false)
  const inputRef = useRef(null)
  const fileInputRef = useRef(null)
  const emojiPopoverRef = useRef(null)
  const recorderRef = useRef(null)
  const recordStreamRef = useRef(null)
  const recordChunksRef = useRef([])
  const recordTimerRef = useRef(null)
  const recordSendRef = useRef(true)

  useEffect(() => {
    if (editingMessage) inputRef.current?.focus()
  }, [editingMessage])

  useEffect(() => {
    return () => {
      if (attachment?.url) URL.revokeObjectURL(attachment.url)
    }
  }, [attachment])

  useEffect(() => {
    const active = Boolean(value.trim() || attachment)
    onTyping(active)
    if (!active) return undefined
    const timer = window.setTimeout(() => onTyping(false), 1400)
    return () => window.clearTimeout(timer)
  }, [attachment, onTyping, value])

  useEffect(() => () => onTyping(false), [onTyping])

  // Persist draft text per chat.
  useEffect(() => {
    if (!draftKey || editingMessage) return
    try {
      if (value.trim()) {
        globalThis.localStorage?.setItem(draftKey, value)
      } else {
        globalThis.localStorage?.removeItem(draftKey)
      }
    } catch {
      // Ignore storage failures (private mode, quota).
    }
  }, [value, draftKey, editingMessage])

  // Auto-resize textarea to content height.
  const resizeTextarea = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [])

  useEffect(() => {
    resizeTextarea()
  }, [value, resizeTextarea])

  // Close emoji popover when clicking outside of it.
  useEffect(() => {
    if (!emojiOpen) return undefined
    function handleOutside(event) {
      if (emojiPopoverRef.current && !emojiPopoverRef.current.contains(event.target)) {
        setEmojiOpen(false)
      }
    }
    window.addEventListener('pointerdown', handleOutside, { capture: true })
    return () => window.removeEventListener('pointerdown', handleOutside, { capture: true })
  }, [emojiOpen])

  // Clean up an in-progress recording if the component unmounts.
  useEffect(() => {
    return () => {
      if (recordTimerRef.current) window.clearInterval(recordTimerRef.current)
      recordStreamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  // Wrap selected text in formatting markers (or insert markers at cursor)
  const wrapSelection = useCallback((prefix, suffix) => {
    const el = inputRef.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const selected = value.slice(start, end)
    const newValue = value.slice(0, start) + prefix + selected + suffix + value.slice(end)
    setValue(newValue)
    const newCursor = selected ? start + prefix.length : start + prefix.length
    const newEnd = selected ? end + prefix.length : start + prefix.length
    window.requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(newCursor, newEnd)
    })
  }, [value])

  function clearDraft() {
    if (!draftKey) return
    try {
      globalThis.localStorage?.removeItem(draftKey)
    } catch {
      // Ignore.
    }
  }

  function clearAttachment() {
    setAttachment(null)
  }

  async function submit() {
    const text = value.trim()
    if ((!text && !attachment) || sending) return
    setSending(true)
    try {
      if (attachment) {
        await onSendAttachment(attachment.file, text)
        clearAttachment()
      } else {
        await onSend(text)
      }
      setValue('')
      clearDraft()
      onTyping(false)
      setEmojiOpen(false)
      // Reset textarea height after clearing.
      if (inputRef.current) inputRef.current.style.height = 'auto'
    } finally {
      setSending(false)
    }
  }

  function sendMockAsset(label) {
    onMockSend(`[mock] ${label}`)
    setEmojiOpen(false)
  }

  function handleKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
      return
    }
    // Formatting shortcuts
    if (event.ctrlKey || event.metaKey) {
      if (event.key === 'b') { event.preventDefault(); wrapSelection('**', '**'); return }
      if (event.key === 'i') { event.preventDefault(); wrapSelection('_', '_'); return }
      if (event.key === 'e') { event.preventDefault(); wrapSelection('`', '`'); return }
      if (event.key === 'u' && event.shiftKey) { event.preventDefault(); wrapSelection('> ', ''); return }
      if (event.key === 'x' && event.shiftKey) { event.preventDefault(); wrapSelection('||', '||'); return }
    }
  }

  async function startRecording() {
    if (recording || sending) return
    const mimeType = getSupportedAudioMimeType()
    if (!mimeType || !navigator.mediaDevices?.getUserMedia) {
      onAttach('Voice recording is not supported in this browser.')
      return
    }
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      onAttach('Microphone access was denied.')
      return
    }
    recordStreamRef.current = stream
    recordChunksRef.current = []
    recordSendRef.current = true
    const recorder = new MediaRecorder(stream, { mimeType })
    recorderRef.current = recorder

    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) recordChunksRef.current.push(event.data)
    })
    recorder.addEventListener('stop', () => {
      stream.getTracks().forEach((track) => track.stop())
      recordStreamRef.current = null
      if (recordTimerRef.current) {
        window.clearInterval(recordTimerRef.current)
        recordTimerRef.current = null
      }
      const shouldSend = recordSendRef.current
      setRecording(false)
      setRecordSeconds(0)
      if (!shouldSend) {
        recordChunksRef.current = []
        return
      }
      const baseType = mimeType.split(';')[0]
      const blob = new Blob(recordChunksRef.current, { type: baseType })
      recordChunksRef.current = []
      if (!blob.size) return
      const extension = baseType.includes('ogg') ? 'ogg' : baseType.includes('mp4') ? 'm4a' : 'webm'
      const file = new File([blob], `voice-${Date.now()}.${extension}`, { type: baseType })
      void onSendAttachment(file, '')
    })

    recorder.start()
    setRecording(true)
    setRecordSeconds(0)
    recordTimerRef.current = window.setInterval(() => {
      setRecordSeconds((current) => {
        // Cap voice notes at 5 minutes.
        if (current >= 300) {
          stopRecording(true)
          return current
        }
        return current + 1
      })
    }, 1000)
  }

  function stopRecording(send) {
    recordSendRef.current = send
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    }
  }

  const mode = editingMessage ? 'Editing message' : replyTo ? 'Replying to message' : ''
  const preview = editingMessage || replyTo
  const canSend = Boolean(value.trim() || attachment)

  return (
    <footer className="composer">
      {preview && (
        <div className={`composer-preview ${editingMessage ? 'edit-preview' : ''}`}>
          <div>
            <strong>{mode}</strong>
            <span>{preview.text}</span>
          </div>
          <button onClick={editingMessage ? onCancelEdit : onCancelReply} aria-label="Cancel mode">
            <X size={18} />
          </button>
        </div>
      )}

      {attachment && (
        <div className="attachment-preview">
          <div className="attachment-preview-media">
            {attachment.file.type.startsWith('image/') ? (
              <img src={attachment.url} alt="" />
            ) : attachment.file.type.startsWith('video/') ? (
              <video src={attachment.url} muted />
            ) : attachment.file.type.startsWith('audio/') ? (
              <span className="attachment-preview-icon">
                <Music size={24} />
              </span>
            ) : (
              <span className="attachment-preview-icon">
                <FileText size={24} />
              </span>
            )}
          </div>
          <div>
            <strong>{attachment.file.name}</strong>
            <span>
              {attachmentKind(attachment.file)} · {(attachment.file.size / 1024 / 1024).toFixed(1)} MB
            </span>
          </div>
          <button onClick={clearAttachment} aria-label="Remove attachment">
            <X size={18} />
          </button>
        </div>
      )}

      {emojiOpen && (
        <div className="emoji-popover" ref={emojiPopoverRef}>
          <div className="emoji-tabs">
            {['emoji', 'sticker', 'gif'].map((tab) => (
              <button key={tab} className={panelTab === tab ? 'active' : ''} onClick={() => setPanelTab(tab)}>
                {tab}
              </button>
            ))}
          </div>
          {panelTab === 'emoji' && (
            <div className="emoji-grid">
              {emojiSet.map((emoji) => (
                <button key={emoji} onClick={() => setValue((current) => `${current}${emoji}`)}>
                  {emoji}
                </button>
              ))}
            </div>
          )}
          {panelTab === 'sticker' &&
            stickers.map((sticker) => (
              <button className="asset-choice" key={sticker} onClick={() => sendMockAsset(sticker)}>
                {sticker}
              </button>
            ))}
          {panelTab === 'gif' &&
            gifs.map((gif) => (
              <button className="asset-choice" key={gif} onClick={() => sendMockAsset(gif)}>
                {gif}
              </button>
            ))}
        </div>
      )}

      {formatBarOpen && !recording && (
        <div className="format-bar">
          <button type="button" title="Bold (Ctrl+B)" onClick={() => wrapSelection('**', '**')}><Bold size={15} /></button>
          <button type="button" title="Italic (Ctrl+I)" onClick={() => wrapSelection('_', '_')}><Italic size={15} /></button>
          <button type="button" title="Code (Ctrl+E)" onClick={() => wrapSelection('`', '`')}><Code size={15} /></button>
          <button type="button" title="Spoiler (Ctrl+Shift+X)" onClick={() => wrapSelection('||', '||')}><Strikethrough size={15} /></button>
          <button type="button" title="Quote (Ctrl+Shift+U)" onClick={() => wrapSelection('> ', '')}>
            <span className="format-quote-icon">&ldquo;</span>
          </button>
          <span className="format-bar-hint">Ctrl+B · Ctrl+I · Ctrl+E</span>
        </div>
      )}

      {recording ? (
        <div className="composer-row recording-row">
          <button className="recording-cancel" onClick={() => stopRecording(false)} aria-label="Cancel recording">
            <Trash2 size={20} />
          </button>
          <div className="recording-status">
            <span className="recording-dot" />
            <span>Recording… {formatRecordTime(recordSeconds)}</span>
          </div>
          <button className="send-button" onClick={() => stopRecording(true)} aria-label="Send voice message">
            <Send size={20} />
          </button>
        </div>
      ) : (
        <div className="composer-row">
          <IconButton label="Emoji, stickers and GIF" onClick={() => setEmojiOpen((open) => !open)}>
            <Smile size={21} />
          </IconButton>
          <IconButton
            label="Text formatting"
            onClick={() => setFormatBarOpen((open) => !open)}
            className={formatBarOpen ? 'is-active' : ''}
          >
            <Bold size={19} />
          </IconButton>
          <IconButton label="Attachment" onClick={() => fileInputRef.current?.click()}>
            <Paperclip size={21} />
          </IconButton>
          <input
            ref={fileInputRef}
            className="visually-hidden"
            type="file"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (!file) return
              if (file.size > 100 * 1024 * 1024) {
                onAttach('File is too large. Maximum size is 100 MB.')
                return
              }
              setAttachment({
                file,
                url: URL.createObjectURL(file),
              })
            }}
          />
          <textarea
            ref={inputRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message"
            rows={1}
          />
          {canSend ? (
            <button className="send-button" onClick={submit} aria-label="Send message" disabled={sending}>
              {sending ? (
                <LoaderCircle className="send-spinner" size={20} />
              ) : attachment ? (
                attachment.file.type.startsWith('image/') ? (
                  <Image size={20} />
                ) : attachment.file.type.startsWith('video/') ? (
                  <FileVideo2 size={20} />
                ) : (
                  <Send size={20} />
                )
              ) : (
                <Send size={20} />
              )}
            </button>
          ) : (
            <IconButton label="Record voice message" onClick={startRecording}>
              <Mic size={21} />
            </IconButton>
          )}
        </div>
      )}
    </footer>
  )
}
