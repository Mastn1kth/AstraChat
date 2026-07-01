// Client-side message translation via the free MyMemory Translation API.
// No API key required, CORS-enabled. Called only after messages are already
// decrypted client-side — plaintext never touches our own backend.
const cache = new Map()

export async function translateText(text, targetLang) {
  if (!text || !text.trim()) return ''
  const cacheKey = `${targetLang}:${text}`
  if (cache.has(cacheKey)) return cache.get(cacheKey)

  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=auto|${targetLang}`
  const response = await fetch(url)
  if (!response.ok) throw new Error('Translation failed')
  const data = await response.json()
  const translated = data?.responseData?.translatedText
  if (!translated) throw new Error('Translation failed')
  cache.set(cacheKey, translated)
  return translated
}
