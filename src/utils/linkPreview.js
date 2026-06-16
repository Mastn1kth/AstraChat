// eslint-disable-next-line no-control-regex
const URL_RE = /https?:\/\/[^\s"'<>()[\]{}|\\^`\x00-\x1f]{4,}/gi

export function extractFirstUrl(text) {
  if (!text) return null
  const matches = text.match(URL_RE)
  return matches?.[0] || null
}

const cache = new Map()

export async function fetchLinkPreview(url) {
  if (cache.has(url)) return cache.get(url)
  try {
    const res = await fetch(`/api/og?url=${encodeURIComponent(url)}`, { credentials: 'same-origin' })
    if (!res.ok) return null
    const data = await res.json()
    if (!data.title && !data.image) return null
    cache.set(url, data)
    return data
  } catch {
    return null
  }
}
