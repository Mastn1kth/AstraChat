import { useEffect, useState } from 'react'
import { PackagePlus, X } from 'lucide-react'
import { getCustomEmojiPacks, installCustomEmojiPack, uninstallCustomEmojiPack } from '../api/client'

export default function CustomEmojiPicker({ onSelect }) {
  const [packs, setPacks] = useState([])
  const [activeTab, setActiveTab] = useState(null)
  const [showBrowse, setShowBrowse] = useState(false)
  const [toggling, setToggling] = useState(null)

  useEffect(() => {
    getCustomEmojiPacks()
      .then((data) => {
        setPacks(data.packs)
        const installed = data.packs.filter((p) => p.installed)
        if (installed.length) setActiveTab(installed[0].id)
      })
      .catch(() => {})
  }, [])

  const installed = packs.filter((p) => p.installed)
  const activePack = packs.find((p) => p.id === activeTab)

  async function toggleInstall(pack) {
    setToggling(pack.id)
    try {
      if (pack.installed) {
        await uninstallCustomEmojiPack(pack.id)
        setPacks((prev) => prev.map((p) => p.id === pack.id ? { ...p, installed: false } : p))
        if (activeTab === pack.id) setActiveTab(installed.find((p) => p.id !== pack.id)?.id || null)
      } else {
        await installCustomEmojiPack(pack.id)
        setPacks((prev) => prev.map((p) => p.id === pack.id ? { ...p, installed: true } : p))
        if (!activeTab) setActiveTab(pack.id)
      }
    } finally {
      setToggling(null)
    }
  }

  if (showBrowse) {
    return (
      <div className="custom-emoji-picker">
        <div className="custom-emoji-browse-header">
          <button className="custom-emoji-back-btn" onClick={() => setShowBrowse(false)}>← Back</button>
          <span>Emoji Packs</span>
        </div>
        <div className="custom-emoji-browse-list">
          {packs.map((pack) => (
            <div key={pack.id} className="custom-emoji-browse-row">
              <img src={pack.thumbnailUrl} alt={pack.title} className="custom-emoji-browse-thumb" />
              <div className="custom-emoji-browse-info">
                <strong>{pack.title}</strong>
                <span>{pack.emoji.length} emoji · {pack.author}</span>
              </div>
              <button
                className={`custom-emoji-install-btn${pack.installed ? ' installed' : ''}`}
                disabled={toggling === pack.id}
                onClick={() => toggleInstall(pack)}
              >
                {toggling === pack.id ? '…' : pack.installed ? <X size={14} /> : <PackagePlus size={14} />}
              </button>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (!installed.length) {
    return (
      <div className="custom-emoji-picker custom-emoji-empty">
        <p>No emoji packs installed.</p>
        <button className="custom-emoji-browse-open-btn" onClick={() => setShowBrowse(true)}>
          <PackagePlus size={16} /> Browse Packs
        </button>
      </div>
    )
  }

  return (
    <div className="custom-emoji-picker">
      <div className="custom-emoji-pack-tabs">
        {installed.map((p) => (
          <button
            key={p.id}
            className={`custom-emoji-pack-tab${activeTab === p.id ? ' active' : ''}`}
            onClick={() => setActiveTab(p.id)}
            title={p.title}
          >
            <img src={p.thumbnailUrl} alt={p.title} />
          </button>
        ))}
        <button className="custom-emoji-pack-tab add-tab" onClick={() => setShowBrowse(true)} title="Browse packs">
          <PackagePlus size={16} />
        </button>
      </div>
      <div className="custom-emoji-grid">
        {activePack?.emoji.map((e) => (
          <button
            key={e.shortcode}
            className="custom-emoji-btn"
            title={`:${e.shortcode}:`}
            onClick={() => onSelect(`:${e.shortcode}:`)}
          >
            <img src={e.imageUrl} alt={e.title || e.shortcode} />
          </button>
        ))}
      </div>
    </div>
  )
}
