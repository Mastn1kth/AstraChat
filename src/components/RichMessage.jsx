import { MapPin, Phone, UserRound } from 'lucide-react'
import LottieAnimation from './LottieAnimation'

export default function RichMessage({ rich }) {
  if (!rich) return null

  if (rich.type === 'sticker') {
    if (rich.lottieUrl || rich.lottieData) {
      return (
        <div className="rich-sticker animated" style={{ '--rich-tone': rich.tone || '#7c3aed' }}>
          <LottieAnimation
            src={rich.lottieUrl}
            animationData={rich.lottieData}
            label={rich.title || 'Animated sticker'}
          />
          <strong>{rich.title || 'Sticker'}</strong>
        </div>
      )
    }
    return (
      <div className="rich-sticker" style={{ '--rich-tone': rich.tone || '#7c3aed' }}>
        <span>{rich.emoji || '🙂'}</span>
        <strong>{rich.title || 'Sticker'}</strong>
      </div>
    )
  }

  if (rich.type === 'gif') {
    if (rich.url) {
      return (
        <div className="rich-gif-img" onClick={(e) => e.stopPropagation()}>
          <img src={rich.url} alt={rich.title || 'GIF'} loading="lazy" />
          <span className="rich-gif-label">GIF</span>
        </div>
      )
    }
    const frames = rich.frames?.length ? rich.frames.slice(0, 3) : ['GIF']
    return (
      <div className="rich-gif" style={{ '--rich-tone': rich.tone || '#7c3aed' }}>
        <div className="rich-gif-stage">
          {frames.map((frame, index) => (
            <span key={`${frame}-${index}`} style={{ '--frame-index': index }}>
              {frame}
            </span>
          ))}
        </div>
        <strong>{rich.title || 'GIF'}</strong>
      </div>
    )
  }

  if (rich.type === 'location' || rich.type === 'live_location') {
    const hasCoords = Number.isFinite(rich.latitude) && Number.isFinite(rich.longitude)
    const mapUrl = hasCoords
      ? `https://www.openstreetmap.org/?mlat=${rich.latitude}&mlon=${rich.longitude}#map=16/${rich.latitude}/${rich.longitude}`
      : ''
    const live = rich.type === 'live_location'
    const expiresAt = rich.expiresAt ? new Date(rich.expiresAt) : null
    const active = live && expiresAt && expiresAt > new Date()
    return (
      <a
        className={`rich-location ${live ? 'live' : ''}`}
        href={mapUrl || undefined}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="rich-location-map">
          <MapPin size={30} />
        </span>
        <span>
          <strong>{rich.title || (live ? 'Live location' : 'Shared location')}</strong>
          {hasCoords && (
            <small>
              {rich.latitude.toFixed(5)}, {rich.longitude.toFixed(5)}
            </small>
          )}
          {live && (
            <small>{active ? 'Live now' : 'Live ended'}{rich.sequence ? ` · update ${rich.sequence}` : ''}</small>
          )}
        </span>
      </a>
    )
  }

  if (rich.type === 'contact') {
    return (
      <div className="rich-contact">
        <span className="rich-contact-avatar">
          <UserRound size={24} />
        </span>
        <span>
          <strong>{rich.name || 'Contact'}</strong>
          {rich.username && <small>{rich.username}</small>}
          {rich.phone && (
            <a href={`tel:${rich.phone}`} onClick={(event) => event.stopPropagation()}>
              <Phone size={12} /> {rich.phone}
            </a>
          )}
        </span>
      </div>
    )
  }

  return null
}
