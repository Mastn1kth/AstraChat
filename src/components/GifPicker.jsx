import { useCallback, useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'

const API_KEY = import.meta.env.VITE_TENOR_API_KEY || ''
const BASE = 'https://tenor.googleapis.com/v2'
const LIMIT = 20

async function fetchTenor(endpoint, params) {
  const url = new URL(`${BASE}/${endpoint}`)
  url.searchParams.set('key', API_KEY)
  url.searchParams.set('limit', LIMIT)
  url.searchParams.set('contentfilter', 'medium')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Tenor ${res.status}`)
  return res.json()
}

function mediaUrl(result) {
  return (
    result?.media_formats?.tinygif?.url ||
    result?.media_formats?.gif?.url ||
    ''
  )
}

function previewUrl(result) {
  return (
    result?.media_formats?.nanogif?.url ||
    result?.media_formats?.tinygif?.url ||
    result?.media_formats?.gif?.url ||
    ''
  )
}

export default function GifPicker({ onSelect }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const debounceRef = useRef(null)
  const inputRef = useRef(null)

  const search = useCallback(async (q) => {
    if (!API_KEY) return
    setLoading(true)
    setError('')
    try {
      const data = q
        ? await fetchTenor('search', { q })
        : await fetchTenor('featured', {})
      setResults(data.results || [])
    } catch {
      setError('Could not load GIFs')
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!API_KEY) return
    let cancelled = false
    async function init() {
      setLoading(true)
      try {
        const data = await fetchTenor('featured', {})
        if (!cancelled) setResults(data.results || [])
      } catch {
        if (!cancelled) setError('Could not load GIFs')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    init()
    inputRef.current?.focus()
    return () => { cancelled = true }
  }, [])

  function handleSearch(e) {
    const q = e.target.value
    setQuery(q)
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => search(q), 400)
  }

  useEffect(() => () => clearTimeout(debounceRef.current), [])

  if (!API_KEY) {
    return (
      <div className="gif-no-key">
        <span>🎞️</span>
        <p>Add <code>VITE_TENOR_API_KEY</code> to <code>.env</code> to enable GIF search</p>
        <a
          href="https://developers.google.com/tenor/guides/quickstart"
          target="_blank"
          rel="noreferrer"
        >
          Get a free key →
        </a>
      </div>
    )
  }

  return (
    <div className="gif-root">
      <div className="gif-search">
        <Search size={14} />
        <input
          ref={inputRef}
          type="search"
          placeholder="Search GIFs…"
          value={query}
          onChange={handleSearch}
        />
      </div>
      <div className="gif-grid">
        {loading && <div className="gif-loading">Loading…</div>}
        {error && <div className="gif-error">{error}</div>}
        {!loading && results.map((result) => (
          <button
            key={result.id}
            className="gif-item"
            onClick={() => onSelect({
              type: 'gif',
              id: result.id,
              title: result.content_description || 'GIF',
              url: mediaUrl(result),
              preview: previewUrl(result),
            })}
          >
            <img
              src={previewUrl(result)}
              alt={result.content_description || 'GIF'}
              loading="lazy"
              decoding="async"
            />
          </button>
        ))}
        {!loading && !error && results.length === 0 && query && (
          <div className="gif-empty">No GIFs found for "{query}"</div>
        )}
      </div>
    </div>
  )
}
