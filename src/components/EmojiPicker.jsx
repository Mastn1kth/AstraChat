import { useEffect, useMemo, useRef, useState } from 'react'
import {
  EMOJI_CATEGORIES,
  EMOJIS_BY_CATEGORY,
  addRecentEmoji,
  getRecentEmojis,
} from '../utils/emojiData'

export default function EmojiPicker({ onSelect }) {
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState('recent')
  const [recents, setRecents] = useState(() => getRecentEmojis())
  const searchRef = useRef(null)
  const bodyRef = useRef(null)
  const categoryRefs = useRef({})

  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  function pick(emoji) {
    addRecentEmoji(emoji)
    setRecents(getRecentEmojis())
    onSelect(emoji)
  }

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return null
    const all = Object.values(EMOJIS_BY_CATEGORY).flat()
    return all.filter((e) => e.includes(q)).slice(0, 80)
  }, [search])

  function scrollToCategory(catId) {
    const el = categoryRefs.current[catId]
    if (el && bodyRef.current) {
      bodyRef.current.scrollTo({ top: el.offsetTop - 4, behavior: 'smooth' })
    }
    setActiveCategory(catId)
  }

  useEffect(() => {
    if (!bodyRef.current || search) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveCategory(entry.target.dataset.cat)
            break
          }
        }
      },
      { root: bodyRef.current, threshold: 0.3 },
    )
    Object.values(categoryRefs.current).forEach((el) => el && observer.observe(el))
    return () => observer.disconnect()
  }, [search])

  const visibleCategories = EMOJI_CATEGORIES.filter((cat) =>
    cat.id === 'recent' ? recents.length > 0 : true,
  )

  return (
    <div className="ep-root">
      <div className="ep-search">
        <input
          ref={searchRef}
          className="ep-search-input"
          type="search"
          placeholder="Search emoji…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {!search && (
        <div className="ep-cats">
          {visibleCategories.map((cat) => (
            <button
              key={cat.id}
              className={`ep-cat-btn ${activeCategory === cat.id ? 'active' : ''}`}
              title={cat.label}
              onClick={() => scrollToCategory(cat.id)}
            >
              {cat.icon}
            </button>
          ))}
        </div>
      )}

      <div className="ep-body" ref={bodyRef}>
        {searchResults ? (
          searchResults.length > 0 ? (
            <div className="ep-grid">
              {searchResults.map((emoji) => (
                <button key={emoji} className="ep-emoji" onClick={() => pick(emoji)}>
                  {emoji}
                </button>
              ))}
            </div>
          ) : (
            <p className="ep-empty">No emoji found</p>
          )
        ) : (
          visibleCategories.map((cat) => {
            const emojis = cat.id === 'recent' ? recents : EMOJIS_BY_CATEGORY[cat.id] || []
            return (
              <div
                key={cat.id}
                ref={(el) => { categoryRefs.current[cat.id] = el }}
                data-cat={cat.id}
                className="ep-section"
              >
                <div className="ep-section-label">{cat.label}</div>
                <div className="ep-grid">
                  {emojis.map((emoji) => (
                    <button key={emoji} className="ep-emoji" onClick={() => pick(emoji)}>
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
