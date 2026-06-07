import { Download, X } from 'lucide-react'

export default function MediaViewer({ media, onClose }) {
  if (!media) return null

  return (
    <div className="media-viewer" role="dialog" aria-modal="true" aria-label="Media viewer">
      <div className="media-viewer-toolbar">
        <a href={media.url} download={media.name} title="Download">
          <Download size={20} />
        </a>
        <button onClick={onClose} aria-label="Close media viewer">
          <X size={22} />
        </button>
      </div>
      <button className="media-viewer-scrim" onClick={onClose} aria-label="Close media viewer" />
      <div className="media-viewer-content">
        {media.kind === 'image' ? (
          <img src={media.url} alt={media.name || 'Shared photo'} />
        ) : (
          <video src={media.url} controls autoPlay />
        )}
      </div>
    </div>
  )
}
