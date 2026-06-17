import { Download, RefreshCw, Upload, X } from 'lucide-react'

export default function DownloadManager({ downloads, uploads = {}, onCancel, onCancelUpload, onRetry, onClear }) {
  const downloadItems = Object.values(downloads)
  const uploadItems = Object.values(uploads)
  const total = downloadItems.length + uploadItems.length
  if (!total) return null

  return (
    <aside className="download-manager" aria-label="Transfer manager">
      <header>
        <strong>Transfers</strong>
        <button onClick={onClear} aria-label="Clear completed transfers">
          <X size={15} />
        </button>
      </header>

      {uploadItems.map((item) => (
        <div key={item.id} className={`download-item ${item.status}`}>
          <span className="download-icon upload-icon">
            <Upload size={16} />
          </span>
          <span className="download-body">
            <strong>{item.name || 'upload'}</strong>
            <small>
              {item.status === 'done' ? 'Uploaded' : item.status === 'failed' ? 'Failed' : `${item.progress}%`}
            </small>
            <i style={{ '--download-progress': `${item.progress}%` }} />
          </span>
          {item.status === 'uploading' && (
            <button onClick={() => onCancelUpload?.(item.id)} aria-label="Cancel upload">
              <X size={14} />
            </button>
          )}
        </div>
      ))}

      {downloadItems.map((item) => (
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
