import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '../i18n'
import {
  BarChart3,
  Bold,
  ChevronDown,
  Clock,
  Code,
  Contact,
  ExternalLink,
  FileText,
  FileVideo2,
  Hash,
  Image,
  Italic,
  LoaderCircle,
  MapPin,
  Mic,
  Music,
  Paperclip,
  Plus,
  Send,
  Smile,
  Strikethrough,
  Trash2,
  X,
} from 'lucide-react'
import IconButton from './IconButton'
import EmojiPicker from './EmojiPicker'
import GifPicker from './GifPicker'
import StickerPicker from './StickerPicker'
import { getMessagePlainText } from '../utils/richMessages'
import { extractFirstUrl, fetchLinkPreview } from '../utils/linkPreview'

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
  forwardSource,
  onCancelForward,
  activeTopic,
  chatMembers,
  onSend,
  onScheduleSend,
  onCancelReply,
  onCancelEdit,
  onAttach,
  onSendAttachment,
  onSendAttachments,
  onSendRichMessage,
  onTyping,
  currentUser,
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
  const [attachments, setAttachments] = useState([])
  const [sending, setSending] = useState(false)
  const [sendProgress, setSendProgress] = useState(null)
  const [recording, setRecording] = useState(false)
  const [recordSeconds, setRecordSeconds] = useState(0)
  const [formatBarOpen, setFormatBarOpen] = useState(false)
  const [linkPreview, setLinkPreview] = useState(null)
  const [suppressPreview, setSuppressPreview] = useState(false)
  const [pollCreator, setPollCreator] = useState(null) // null | { question, options, multipleChoice }
  const [schedulePickerOpen, setSchedulePickerOpen] = useState(false)
  const [scheduleAt, setScheduleAt] = useState('')
  const [mentionQuery, setMentionQuery] = useState(null) // null | { query, start, end }
  const [mentionIndex, setMentionIndex] = useState(0)
  const inputRef = useRef(null)
  const fileInputRef = useRef(null)
  const emojiPopoverRef = useRef(null)
  const recorderRef = useRef(null)
  const recordStreamRef = useRef(null)
  const recordChunksRef = useRef([])
  const recordTimerRef = useRef(null)
  const recordSendRef = useRef(true)
  const sendAbortRef = useRef(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    if (editingMessage) inputRef.current?.focus()
  }, [editingMessage])

  useEffect(() => {
    return () => {
      attachments.forEach((attachment) => URL.revokeObjectURL(attachment.url))
    }
  }, [attachments])

  useEffect(() => {
    const active = Boolean(value.trim() || attachments.length)
    onTyping(active)
    if (!active) return undefined
    const timer = window.setTimeout(() => onTyping(false), 1400)
    return () => window.clearTimeout(timer)
  }, [attachments.length, onTyping, value])

  useEffect(() => () => onTyping(false), [onTyping])

  useEffect(() => {
    if (!draftKey || editingMessage) return
    try {
      if (value.trim()) {
        globalThis.localStorage?.setItem(draftKey, value)
      } else {
        globalThis.localStorage?.removeItem(draftKey)
      }
    } catch {
      // Ignore storage failures.
    }
  }, [value, draftKey, editingMessage])

  useEffect(() => {
    if (suppressPreview) return undefined
    const url = extractFirstUrl(value)
    const timer = window.setTimeout(async () => {
      if (!url) { setLinkPreview(null); return }
      const data = await fetchLinkPreview(url)
      setLinkPreview(data ? { ...data, url } : null)
    }, url ? 600 : 0)
    return () => window.clearTimeout(timer)
  }, [value, suppressPreview])

  const resizeTextarea = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [])

  useEffect(() => {
    resizeTextarea()
  }, [value, resizeTextarea])

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

  const clearRecordingTimer = useCallback(() => {
    if (!recordTimerRef.current) return
    window.clearInterval(recordTimerRef.current)
    recordTimerRef.current = null
  }, [])

  const stopRecordStream = useCallback((stream = recordStreamRef.current) => {
    stream?.getTracks().forEach((track) => track.stop())
    if (!stream || recordStreamRef.current === stream) recordStreamRef.current = null
  }, [])

  const resetRecordingState = useCallback(() => {
    clearRecordingTimer()
    if (!mountedRef.current) return
    setRecording(false)
    setRecordSeconds(0)
  }, [clearRecordingTimer])

  useEffect(() => {
    return () => {
      mountedRef.current = false
      recordSendRef.current = false
      clearRecordingTimer()
      const recorder = recorderRef.current
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop()
      } else {
        recorderRef.current = null
        stopRecordStream()
      }
      recordChunksRef.current = []
      sendAbortRef.current?.abort()
    }
  }, [clearRecordingTimer, stopRecordStream])

  const wrapSelection = useCallback((prefix, suffix) => {
    const el = inputRef.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const selected = value.slice(start, end)
    const newValue = value.slice(0, start) + prefix + selected + suffix + value.slice(end)
    setValue(newValue)
    const newCursor = start + prefix.length
    const newEnd = selected ? end + prefix.length : newCursor
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
    setAttachments((current) => {
      current.forEach((attachment) => URL.revokeObjectURL(attachment.url))
      return []
    })
  }

  async function submit(scheduledAt) {
    const text = value.trim()
    const hasForwardText = Boolean(forwardSource && getMessagePlainText(forwardSource).trim())
    if ((!text && !attachments.length && !hasForwardText) || sending) return
    const controller = new AbortController()
    sendAbortRef.current = controller
    setSending(true)
    setSendProgress(attachments.length ? 0 : null)
    try {
      if (attachments.length) {
        const files = attachments.map((attachment) => attachment.file)
        const sender = onSendAttachments || ((singleFiles, caption, options) => onSendAttachment(singleFiles[0], caption, options))
        await sender(files, text, {
          signal: controller.signal,
          onUploadProgress: setSendProgress,
          scheduledAt,
        })
        clearAttachment()
      } else if (scheduledAt && onScheduleSend) {
        await onScheduleSend(text, linkPreview || undefined, scheduledAt, activeTopic?.id)
      } else {
        await onSend(text, linkPreview || undefined, activeTopic?.id)
      }
      setValue('')
      clearDraft()
      onTyping(false)
      setEmojiOpen(false)
      setLinkPreview(null)
      setSuppressPreview(false)
      setScheduleAt('')
      setSchedulePickerOpen(false)
      if (inputRef.current) inputRef.current.style.height = 'auto'
    } catch (error) {
      if (error.name !== 'AbortError') throw error
    } finally {
      setSending(false)
      setSendProgress(null)
      sendAbortRef.current = null
    }
  }

  function confirmSchedule() {
    if (!scheduleAt) return
    const at = new Date(scheduleAt)
    if (Number.isNaN(at.getTime()) || at <= new Date()) return
    submit(at.toISOString())
  }

  function sendRichAsset(rich) {
    if (sending) return
    onSendRichMessage?.(rich)
    setEmojiOpen(false)
  }

  function openPollCreator() {
    setPollCreator({ question: '', options: ['', ''], multipleChoice: false })
    setPanelTab('share')
  }

  async function sendPoll() {
    if (!pollCreator) return
    const question = pollCreator.question.trim()
    const options = pollCreator.options.map((o) => o.trim()).filter(Boolean)
    if (!question || options.length < 2) return
    onSendRichMessage?.({
      type: 'poll',
      poll: {
        question,
        options,
        multipleChoice: pollCreator.multipleChoice,
        anonymous: false,
        quiz: false,
      },
    })
    setPollCreator(null)
    setEmojiOpen(false)
  }

  function shareContactCard() {
    sendRichAsset({
      type: 'contact',
      name: currentUser?.name || 'Contact',
      username: currentUser?.username || '',
      phone: currentUser?.phone || '',
    })
  }

  function shareLocation() {
    if (!navigator.geolocation) {
      onAttach(t('err.noGeo'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        sendRichAsset({
          type: 'location',
          title: 'Shared location',
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        })
      },
      () => onAttach(t('err.geoDenied')),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    )
  }

  const mentionSuggestions = mentionQuery
    ? (chatMembers || []).filter((m) => {
        const q = mentionQuery.query.toLowerCase()
        if (!q) return m.id !== currentUser?.id
        return (
          m.username?.toLowerCase().includes(q) ||
          m.name?.toLowerCase().includes(q)
        )
      }).slice(0, 6)
    : []

  function detectMentionTrigger(text, cursor) {
    const before = text.slice(0, cursor)
    const match = before.match(/(^|[\s\n])@(\w*)$/)
    if (!match) return null
    const start = before.lastIndexOf('@')
    return { query: match[2], start, end: cursor }
  }

  function handleValueChange(newValue) {
    setValue(newValue)
    const cursor = inputRef.current?.selectionStart ?? newValue.length
    const trigger = detectMentionTrigger(newValue, cursor)
    setMentionQuery(trigger)
    setMentionIndex(0)
  }

  function insertMention(member) {
    if (!mentionQuery) return
    const username = member.username?.replace(/^@/, '') || member.name
    const before = value.slice(0, mentionQuery.start)
    const after = value.slice(mentionQuery.end)
    const inserted = `@${username} `
    const next = `${before}${inserted}${after}`
    setValue(next)
    setMentionQuery(null)
    const pos = mentionQuery.start + inserted.length
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (el) { el.focus(); el.setSelectionRange(pos, pos) }
    })
  }

  function handleKeyDown(event) {
    if (mentionQuery && mentionSuggestions.length) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setMentionIndex((i) => (i + 1) % mentionSuggestions.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setMentionIndex((i) => (i - 1 + mentionSuggestions.length) % mentionSuggestions.length)
        return
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && mentionQuery)) {
        event.preventDefault()
        insertMention(mentionSuggestions[mentionIndex])
        return
      }
      if (event.key === 'Escape') {
        setMentionQuery(null)
        return
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
      return
    }
    if (event.ctrlKey || event.metaKey) {
      if (event.key === 'b') { event.preventDefault(); wrapSelection('**', '**'); return }
      if (event.key === 'i') { event.preventDefault(); wrapSelection('_', '_'); return }
      if (event.key === 'e') { event.preventDefault(); wrapSelection('`', '`'); return }
      if (event.key === 'u' && event.shiftKey) { event.preventDefault(); wrapSelection('> ', ''); return }
      if (event.key === 'x' && event.shiftKey) { event.preventDefault(); wrapSelection('||', '||') }
    }
  }

  async function startRecording() {
    if (recording || sending) return
    const mimeType = getSupportedAudioMimeType()
    if (!mimeType || !navigator.mediaDevices?.getUserMedia) {
      onAttach(t('err.noMic'))
      return
    }
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      onAttach(t('err.micDenied'))
      return
    }
    recordStreamRef.current = stream
    recordChunksRef.current = []
    recordSendRef.current = true
    let recorder
    try {
      recorder = new MediaRecorder(stream, { mimeType })
    } catch {
      stopRecordStream(stream)
      onAttach(t('err.noMic'))
      return
    }
    recorderRef.current = recorder

    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) recordChunksRef.current.push(event.data)
    })
    recorder.addEventListener('stop', () => {
      recorderRef.current = null
      stopRecordStream(stream)
      const shouldSend = recordSendRef.current
      resetRecordingState()
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
      if (mountedRef.current) void onSendAttachment(file, '')
    })

    recorder.start()
    setRecording(true)
    setRecordSeconds(0)
    recordTimerRef.current = window.setInterval(() => {
      setRecordSeconds((current) => {
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
      return
    }
    stopRecordStream()
    resetRecordingState()
  }

  const mode = editingMessage ? t('composer.editing') : replyTo ? t('composer.replying') : forwardSource ? t('composer.forwarding') : ''
  const preview = editingMessage || replyTo || forwardSource
  const previewText = forwardSource ? getMessagePlainText(forwardSource) : preview?.text
  const canSend = Boolean(value.trim() || attachments.length || previewText?.trim())

  return (
    <footer className="composer">
      {activeTopic && (
        <div className="composer-topic-bar">
          <Hash size={13} />
          <span>{activeTopic.title}</span>
          {activeTopic.closed && <span className="composer-topic-closed">closed</span>}
        </div>
      )}
      {preview && (
        <div className={`composer-preview ${editingMessage ? 'edit-preview' : ''}`}>
          <div>
            <strong>{mode}</strong>
            <span>{previewText}</span>
          </div>
          <button onClick={editingMessage ? onCancelEdit : forwardSource ? onCancelForward : onCancelReply} aria-label="Cancel mode">
            <X size={18} />
          </button>
        </div>
      )}

      {attachments.length > 0 && (
        <div className={`attachment-preview ${attachments.length > 1 ? 'album-preview' : ''}`}>
          <div className="attachment-preview-strip">
            {attachments.slice(0, 4).map((attachment) => (
              <div className="attachment-preview-media" key={attachment.url}>
                {attachment.file.type.startsWith('image/') ? (
                  <img src={attachment.url} alt="" />
                ) : attachment.file.type.startsWith('video/') ? (
                  <video src={attachment.url} muted />
                ) : attachment.file.type.startsWith('audio/') ? (
                  <span className="attachment-preview-icon"><Music size={24} /></span>
                ) : (
                  <span className="attachment-preview-icon"><FileText size={24} /></span>
                )}
              </div>
            ))}
          </div>
          <div>
            <strong>{attachments.length === 1 ? attachments[0].file.name : `${attachments.length} files as album`}</strong>
            <span>
              {attachments.length === 1
                ? `${attachmentKind(attachments[0].file)} · ${(attachments[0].file.size / 1024 / 1024).toFixed(1)} MB`
                : `Album · ${(attachments.reduce((sum, item) => sum + item.file.size, 0) / 1024 / 1024).toFixed(1)} MB`}
            </span>
            {sendProgress !== null && (
              <span className="upload-progress">
                <i style={{ '--upload-progress': `${sendProgress}%` }} />
                {sendProgress}%
              </span>
            )}
          </div>
          <button
            onClick={() => {
              if (sending) sendAbortRef.current?.abort()
              else clearAttachment()
            }}
            aria-label={sending ? 'Cancel upload' : 'Remove attachment'}
          >
            <X size={18} />
          </button>
        </div>
      )}

      {linkPreview && !suppressPreview && (
        <div className="composer-link-preview">
          {linkPreview.image && (
            <img
              className="composer-link-preview-img"
              src={linkPreview.image}
              alt=""
              onError={(e) => { e.currentTarget.style.display = 'none' }}
            />
          )}
          <div className="composer-link-preview-body">
            {linkPreview.site && <span className="composer-link-preview-site">{linkPreview.site}</span>}
            {linkPreview.title && <strong className="composer-link-preview-title">{linkPreview.title}</strong>}
            {linkPreview.description && <span className="composer-link-preview-desc">{linkPreview.description}</span>}
            <span className="composer-link-preview-url">
              <ExternalLink size={10} />{' '}
              {(() => { try { return new URL(linkPreview.url).hostname } catch { return linkPreview.url } })()}
            </span>
          </div>
          <button
            className="composer-link-preview-dismiss"
            aria-label="Dismiss link preview"
            onClick={() => setSuppressPreview(true)}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {emojiOpen && (
        <div className="emoji-popover" ref={emojiPopoverRef}>
          <div className="emoji-tabs">
            {['emoji', 'sticker', 'gif', 'share'].map((tab) => (
              <button key={tab} className={panelTab === tab ? 'active' : ''} onClick={() => setPanelTab(tab)}>
                {tab === 'emoji' ? '😀' : tab === 'sticker' ? '🎭' : tab === 'gif' ? 'GIF' : '📎'}
              </button>
            ))}
          </div>
          {panelTab === 'emoji' && (
            <EmojiPicker
              onSelect={(emoji) => {
                setValue((current) => `${current}${emoji}`)
                inputRef.current?.focus()
              }}
            />
          )}
          {panelTab === 'sticker' && (
            <StickerPicker
              onSelect={(rich) => { sendRichAsset(rich); setEmojiOpen(false) }}
            />
          )}
          {panelTab === 'gif' && (
            <GifPicker onSelect={(gif) => { sendRichAsset(gif); setEmojiOpen(false) }} />
          )}
          {panelTab === 'share' && (
            <>
              {pollCreator ? (
                <div className="poll-creator">
                  <input
                    className="poll-creator-question"
                    placeholder="Question…"
                    value={pollCreator.question}
                    maxLength={255}
                    onChange={(e) => setPollCreator((p) => ({ ...p, question: e.target.value }))}
                  />
                  <div className="poll-creator-options">
                    {pollCreator.options.map((opt, i) => (
                      <div key={i} className="poll-creator-option-row">
                        <input
                          placeholder={`Option ${i + 1}`}
                          value={opt}
                          maxLength={100}
                          onChange={(e) => {
                            const options = [...pollCreator.options]
                            options[i] = e.target.value
                            setPollCreator((p) => ({ ...p, options }))
                          }}
                        />
                        {pollCreator.options.length > 2 && (
                          <button
                            type="button"
                            className="poll-remove-option"
                            onClick={() => setPollCreator((p) => ({ ...p, options: p.options.filter((_, j) => j !== i) }))}
                          >
                            <X size={13} />
                          </button>
                        )}
                      </div>
                    ))}
                    {pollCreator.options.length < 10 && (
                      <button
                        type="button"
                        className="poll-add-option"
                        onClick={() => setPollCreator((p) => ({ ...p, options: [...p.options, ''] }))}
                      >
                        <Plus size={13} /> Add option
                      </button>
                    )}
                  </div>
                  <label className="poll-creator-toggle">
                    <input
                      type="checkbox"
                      checked={pollCreator.multipleChoice}
                      onChange={(e) => setPollCreator((p) => ({ ...p, multipleChoice: e.target.checked }))}
                    />
                    Multiple answers
                  </label>
                  <div className="poll-creator-actions">
                    <button type="button" onClick={() => setPollCreator(null)}>Cancel</button>
                    <button
                      type="button"
                      className="primary-button"
                      disabled={!pollCreator.question.trim() || pollCreator.options.filter((o) => o.trim()).length < 2}
                      onClick={sendPoll}
                    >
                      Create poll
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button className="asset-choice rich-asset-choice" onClick={openPollCreator}>
                    <BarChart3 size={17} /> Poll
                  </button>
                  <button className="asset-choice rich-asset-choice" onClick={shareLocation}>
                    <MapPin size={17} /> Location
                  </button>
                  <button className="asset-choice rich-asset-choice" onClick={shareContactCard}>
                    <Contact size={17} /> Contact card
                  </button>
                </>
              )}
            </>
          )}
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
            <span>{t('composer.recording')} {formatRecordTime(recordSeconds)}</span>
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
            className={formatBarOpen ? 'is-active' : ''}
            onClick={() => setFormatBarOpen((open) => !open)}
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
            multiple
            onChange={(event) => {
              const files = Array.from(event.target.files || [])
              event.target.value = ''
              if (!files.length) return
              if (files.some((file) => file.size > 100 * 1024 * 1024)) {
                onAttach(t('err.fileTooLarge'))
                return
              }
              setAttachments((current) => {
                current.forEach((attachment) => URL.revokeObjectURL(attachment.url))
                return files.map((file) => ({ file, url: URL.createObjectURL(file) }))
              })
            }}
          />
          {mentionQuery && mentionSuggestions.length > 0 && (
            <ul className="mention-popup">
              {mentionSuggestions.map((m, i) => (
                <li
                  key={m.id}
                  className={i === mentionIndex ? 'active' : ''}
                  onMouseDown={(e) => { e.preventDefault(); insertMention(m) }}
                >
                  <strong>{m.name}</strong>
                  {m.username && <small>@{m.username.replace(/^@/, '')}</small>}
                </li>
              ))}
            </ul>
          )}
          <textarea
            ref={inputRef}
            value={value}
            onChange={(event) => handleValueChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('composer.placeholder')}
            rows={1}
          />
          {canSend ? (
            <div className="send-btn-group">
              <button className="send-button" onClick={() => submit()} aria-label="Send message" disabled={sending}>
                {sending ? (
                  <LoaderCircle className="send-spinner" size={20} />
                ) : attachments.length ? (
                  attachments.length > 1 || attachments[0].file.type.startsWith('image/') ? (
                    <Image size={20} />
                  ) : attachments[0].file.type.startsWith('video/') ? (
                    <FileVideo2 size={20} />
                  ) : (
                    <Send size={20} />
                  )
                ) : (
                  <Send size={20} />
                )}
              </button>
              {onScheduleSend && !editingMessage && (
                <div className="schedule-send-wrap">
                  <button
                    className="schedule-chevron"
                    aria-label="Schedule message"
                    title="Schedule send"
                    onClick={() => setSchedulePickerOpen((open) => !open)}
                    disabled={sending}
                  >
                    <ChevronDown size={13} />
                  </button>
                  {schedulePickerOpen && (
                    <div className="schedule-picker">
                      <label>
                        <Clock size={13} /> Send at
                        <input
                          type="datetime-local"
                          value={scheduleAt}
                          min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
                          onChange={(e) => setScheduleAt(e.target.value)}
                        />
                      </label>
                      <button
                        className="primary-button"
                        disabled={!scheduleAt}
                        onClick={confirmSchedule}
                      >
                        Schedule
                      </button>
                      <button onClick={() => setSchedulePickerOpen(false)}>Cancel</button>
                    </div>
                  )}
                </div>
              )}
            </div>
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
