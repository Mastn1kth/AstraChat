import { useCallback, useEffect, useState } from 'react'
import { Clock, Send, Trash2, RefreshCw, X } from 'lucide-react'
import { getScheduledMessages, sendScheduledMessageNow, deleteScheduledMessage } from '../api/client'

function formatScheduledTime(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  const now = new Date()
  const diffMs = date - now
  const diffMins = Math.round(diffMs / 60000)
  if (diffMins < 60) return `in ${diffMins}m`
  if (diffMins < 1440) return `in ${Math.round(diffMins / 60)}h`
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function ScheduledPanel({ chatId, onClose }) {
  const [messages, setMessages] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!chatId) return
    setLoading(true)
    setError('')
    try {
      const data = await getScheduledMessages(chatId)
      setMessages(data.messages || data || [])
    } catch (err) {
      setError(err.message || 'Failed to load scheduled messages')
    } finally {
      setLoading(false)
    }
  }, [chatId])

  useEffect(() => {
    const timer = window.setTimeout(() => { load() }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  async function sendNow(messageId) {
    try {
      await sendScheduledMessageNow(chatId, messageId)
      setMessages((current) => (current || []).filter((m) => m.id !== messageId))
    } catch (err) {
      setError(err.message || 'Failed to send')
    }
  }

  async function remove(messageId) {
    try {
      await deleteScheduledMessage(chatId, messageId)
      setMessages((current) => (current || []).filter((m) => m.id !== messageId))
    } catch (err) {
      setError(err.message || 'Failed to delete')
    }
  }

  return (
    <aside className="side-panel scheduled-panel">
      <header>
        <strong><Clock size={16} /> Scheduled messages</strong>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={load} aria-label="Refresh" disabled={loading}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
          </button>
          <button onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
      </header>

      <div className="scheduled-list">
        {error && <p className="shared-empty" style={{ color: 'var(--danger)' }}>{error}</p>}
        {!error && loading && <p className="shared-empty">Loading…</p>}
        {!error && !loading && messages?.length === 0 && (
          <p className="shared-empty">No scheduled messages</p>
        )}
        {(messages || []).map((msg) => (
          <div key={msg.id} className="scheduled-item">
            <div className="scheduled-item-body">
              <span className="scheduled-item-time">
                <Clock size={12} /> {formatScheduledTime(msg.scheduledAt)}
              </span>
              <p className="scheduled-item-text">{msg.text || '(media)'}</p>
            </div>
            <div className="scheduled-item-actions">
              <button
                className="scheduled-send-now"
                title="Send now"
                onClick={() => sendNow(msg.id)}
              >
                <Send size={14} />
              </button>
              <button
                className="remove-member-btn"
                title="Delete"
                onClick={() => remove(msg.id)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}
