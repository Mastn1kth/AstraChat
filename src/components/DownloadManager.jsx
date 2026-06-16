import { Download, RefreshCw, X } from 'lucide-react'

export default function DownloadManager({ downloads, onCancel, onRetry, onClear }) {
  const items = Object.values(downloads)
  if (!items.length) return null

  return (
    <aside className="download-manager" aria-label="Download manager">
      <header>
        <strong>Downloads</strong>
        <button onClick={onClear} aria-label="Clear completed downloads">
          <X size={15} />
        </button>
      </header>
      {items.map((item) => (
        <div key={item.id} className={`download-item ${item.status}`}>
          <span className="download-icon">
            <Download size={16} />
          </span>
          <span className="download-body">
            <strong>{item.name || 'download'}</strong>
            <small>{item.status === 'done' ? 'Complete' : item.status === 'failed' ? 'Failed' : `${item.progress}%`}</small>
            <i style={{ '--download-progress': `${item.progress}%` }} />
          </span>
          {item.status === 'downloading' && (
            <button onClick={() => onCancel(item.id)} aria-label="Cancel download">
              <X size={14} />
            </button>
          )}
          {item.status === 'failed' && (
            <button onClick={() => onRetry(item.id)} aria-label="Retry download">
              <RefreshCw size={14} />
            </button>
          )}
        </div>
      ))}
    </aside>
  )
}
