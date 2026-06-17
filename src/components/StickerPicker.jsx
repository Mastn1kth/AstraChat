import { useEffect, useRef, useState } from 'react'
import { PackagePlus, Search, Star, X } from 'lucide-react'
import { getInstalledStickerPacks, getStickerPacks, installStickerPack, uninstallStickerPack } from '../api/client'
import { stickerPacks as builtinPacks } from '../utils/richMessages'
import {
  addRecentSticker,
  getFavoriteStickers,
  getRecentStickers,
  toggleFavoriteSticker,
} from '../utils/stickerStorage'

export default function StickerPicker({ onSelect }) {
  const [packs, setPacks] = useState([])
  const [browsePacks, setBrowsePacks] = useState([])
  const [activeTab, setActiveTab] = useState('recent')
  const [search, setSearch] = useState('')
  const [showBrowse, setShowBrowse] = useState(false)
  const [favorites, setFavorites] = useState(() => getFavoriteStickers())
  const [recents, setRecents] = useState(() => getRecentStickers())
  const [togglingPack, setTogglingPack] = useState(null)
  const searchRef = useRef(null)

  useEffect(() => {
    getInstalledStickerPacks()
      .then((data) => {
        if (data.packs.length) {
          setPacks(data.packs)
          if (activeTab === 'recent' && data.packs.length) {
            setActiveTab(recents.length ? 'recent' : data.packs[0].id)
          }
        } else {
          setPacks(builtinPacks.map((p) => ({ ...p, stickers: p.stickers.map((s) => ({ ...s, packId: p.id })) })))
        }
      })
      .catch(() => {
        setPacks(builtinPacks.map((p) => ({ ...p, stickers: p.stickers.map((s) => ({ ...s, packId: p.id })) })))
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function openBrowse() {
    setShowBrowse(true)
    getStickerPacks()
      .then((data) => setBrowsePacks(data.packs))
      .catch(() => {})
  }

  async function toggleInstall(pack) {
    setTogglingPack(pack.id)
    try {
      if (pack.installed) {
        await uninstallStickerPack(pack.id)
        setPacks((prev) => prev.filter((p) => p.id !== pack.id))
        setBrowsePacks((prev) => prev.map((p) => p.id === pack.id ? { ...p, installed: false } : p))
      } else {
        await installStickerPack(pack.id)
        const installed = { ...pack, installed: true }
        setPacks((prev) => [...prev.filter((p) => p.id !== pack.id), installed])
        setBrowsePacks((prev) => prev.map((p) => p.id === pack.id ? { ...p, installed: true } : p))
        if (activeTab === 'recent' && !recents.length) setActiveTab(pack.id)
      }
    } finally {
      setTogglingPack(null)
    }
  }

  function pickSticker(sticker) {
    addRecentSticker(sticker)
    setRecents(getRecentStickers())
    onSelect({ type: 'sticker', ...sticker })
  }

  function handleFav(sticker, e) {
    e.stopPropagation()
    toggleFavoriteSticker(sticker)
    setFavorites(getFavoriteStickers())
  }

  const allStickers = packs.flatMap((p) => p.stickers || [])

  const searchResults = search.trim()
    ? allStickers.filter((s) =>
        s.title.toLowerCase().includes(search.toLowerCase()) ||
        s.emoji.includes(search),
      )
    : null

  const activePackStickers = (() => {
    if (searchResults) return null
    if (activeTab === 'recent') return recents
    if (activeTab === 'favorites') return favorites
    return packs.find((p) => p.id === activeTab)?.stickers ?? []
  })()

  const displayStickers = searchResults ?? activePackStickers ?? []

  if (showBrowse) {
    return (
      <div className="sticker-panel">
        <div className="sticker-browse-header">
          <button className="sticker-browse-back" onClick={() => setShowBrowse(false)}>
            ← Back
          </button>
          <span>Sticker packs</span>
        </div>
        <div className="sticker-browse-list">
          {browsePacks.map((pack) => (
            <div key={pack.id} className="sticker-browse-row">
              <span className="sticker-browse-icon">{pack.icon}</span>
              <div className="sticker-browse-info">
                <strong>{pack.title}</strong>
                <span>{pack.stickers?.length ?? 0} stickers</span>
              </div>
              <button
                className={`sticker-browse-action ${pack.installed ? 'installed' : ''}`}
                disabled={togglingPack === pack.id}
                onClick={() => toggleInstall(pack)}
              >
                {togglingPack === pack.id ? '…' : pack.installed ? <X size={14} /> : <PackagePlus size={14} />}
                {pack.installed ? 'Remove' : 'Add'}
              </button>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="sticker-panel">
      <div className="sticker-search-row">
        <Search size={14} className="sticker-search-icon" />
        <input
          ref={searchRef}
          className="sticker-search"
          placeholder="Search stickers…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button className="sticker-search-clear" onClick={() => setSearch('')}>
            <X size={13} />
          </button>
        )}
      </div>

      <div className="sticker-grid">
        {displayStickers.length === 0 && (
          <p className="sticker-empty">
            {search ? 'No results' : activeTab === 'recent' ? 'No recent stickers' : 'No favorites yet'}
          </p>
        )}
        {displayStickers.map((sticker) => {
          const isFav = favorites.some((f) => f.packId === sticker.packId && f.id === sticker.id)
          return (
            <button
              key={`${sticker.packId}-${sticker.id}`}
              className="sticker-item"
              title={sticker.title}
              onClick={() => pickSticker(sticker)}
            >
              {sticker.emoji}
              <button
                className={`sticker-fav-btn ${isFav ? 'active' : ''}`}
                aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
                onClick={(e) => handleFav(sticker, e)}
              >
                <Star size={10} />
              </button>
            </button>
          )
        })}
      </div>

      <div className="sticker-pack-tabs">
        <button
          className={`sticker-pack-tab ${activeTab === 'recent' ? 'active' : ''}`}
          title="Recent"
          onClick={() => { setSearch(''); setActiveTab('recent') }}
        >
          🕐
        </button>
        <button
          className={`sticker-pack-tab ${activeTab === 'favorites' ? 'active' : ''}`}
          title="Favorites"
          onClick={() => { setSearch(''); setActiveTab('favorites') }}
        >
          <Star size={15} />
        </button>
        {packs.map((pack) => (
          <button
            key={pack.id}
            className={`sticker-pack-tab ${activeTab === pack.id ? 'active' : ''}`}
            title={pack.title}
            onClick={() => { setSearch(''); setActiveTab(pack.id) }}
          >
            {pack.icon}
          </button>
        ))}
        <button
          className="sticker-pack-tab sticker-pack-tab-add"
          title="Browse sticker packs"
          onClick={openBrowse}
        >
          <PackagePlus size={15} />
        </button>
      </div>
    </div>
  )
}
