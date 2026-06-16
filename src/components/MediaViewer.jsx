import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Download, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react'

const MIN_SCALE = 1
const MAX_SCALE = 4
const ZOOM_STEP = 0.25

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export default function MediaViewer({ media, items = [], initialIndex = 0, onClose, onDownload }) {
  const mediaItems = useMemo(() => (items.length ? items : [media]).filter(Boolean), [items, media])
  const [index, setIndex] = useState(() => clamp(initialIndex, 0, Math.max(0, mediaItems.length - 1)))
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragRef = useRef(null)
  const activeMedia = mediaItems[index] || mediaItems[0]
  const canNavigate = mediaItems.length > 1

  const resetTransform = useCallback(() => {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [])

  const navigate = useCallback((direction) => {
    if (!canNavigate) return
    resetTransform()
    setIndex((current) => (current + direction + mediaItems.length) % mediaItems.length)
  }, [canNavigate, mediaItems.length, resetTransform])

  const zoomBy = useCallback((delta) => {
    setScale((current) => {
      const next = clamp(current + delta, MIN_SCALE, MAX_SCALE)
      if (next === MIN_SCALE) setOffset({ x: 0, y: 0 })
      return next
    })
  }, [])

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') onClose?.()
      if (event.key === 'ArrowLeft') navigate(-1)
      if (event.key === 'ArrowRight') navigate(1)
      if (event.key === '+' || event.key === '=') zoomBy(ZOOM_STEP)
      if (event.key === '-') zoomBy(-ZOOM_STEP)
      if (event.key === '0') resetTransform()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [navigate, onClose, resetTransform, zoomBy])

  if (!activeMedia) return null

  function handleWheel(event) {
    event.preventDefault()
    zoomBy(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP)
  }

  function handlePointerDown(event) {
    if (event.button !== undefined && event.button !== 0) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      scale,
    }
  }

  function handlePointerMove(event) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const deltaX = event.clientX - drag.lastX
    const deltaY = event.clientY - drag.lastY
    drag.lastX = event.clientX
    drag.lastY = event.clientY

    if (drag.scale <= MIN_SCALE) return
    setOffset((current) => ({
      x: current.x + deltaX,
      y: current.y + deltaY,
    }))
  }

  function handlePointerUp(event) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)

    const totalX = event.clientX - drag.startX
    const totalY = event.clientY - drag.startY
    if (drag.scale === MIN_SCALE && canNavigate && Math.abs(totalX) > 48 && Math.abs(totalX) > Math.abs(totalY) * 1.4) {
      navigate(totalX < 0 ? 1 : -1)
    }
  }

  return (
    <div className="media-viewer" role="dialog" aria-modal="true" aria-label="Media viewer">
      <div className="media-viewer-toolbar">
        <button onClick={() => zoomBy(ZOOM_STEP)} title="Zoom in" aria-label="Zoom in">
          <ZoomIn size={20} />
        </button>
        <button onClick={() => zoomBy(-ZOOM_STEP)} title="Zoom out" aria-label="Zoom out">
          <ZoomOut size={20} />
        </button>
        <button onClick={resetTransform} title="Reset zoom" aria-label="Reset zoom">
          <RotateCcw size={20} />
        </button>
        <button onClick={() => onDownload?.(activeMedia)} title="Download" aria-label="Download media">
          <Download size={20} />
        </button>
        <button onClick={onClose} aria-label="Close media viewer">
          <X size={22} />
        </button>
      </div>
      <button className="media-viewer-scrim" onClick={onClose} aria-label="Close media viewer" />
      {canNavigate && (
        <>
          <button className="media-viewer-nav previous" onClick={() => navigate(-1)} aria-label="Previous media">
            <ChevronLeft size={28} />
          </button>
          <button className="media-viewer-nav next" onClick={() => navigate(1)} aria-label="Next media">
            <ChevronRight size={28} />
          </button>
          <span className="media-viewer-counter">
            {index + 1}/{mediaItems.length}
          </span>
        </>
      )}
      <div
        className={`media-viewer-content ${scale > MIN_SCALE ? 'is-zoomed' : ''}`}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => { dragRef.current = null }}
      >
        {activeMedia.kind === 'image' ? (
          <img
            src={activeMedia.url}
            alt={activeMedia.name || 'Shared photo'}
            draggable="false"
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
          />
        ) : (
          <video
            src={activeMedia.url}
            controls
            autoPlay
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
          />
        )}
      </div>
    </div>
  )
}
