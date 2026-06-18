import { Router } from 'express'
import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { requireAuth } from '../auth.js'

const router = Router()

const ogCache = new Map()
const OG_CACHE_TTL = 60 * 60 * 1000
const OG_FETCH_TIMEOUT = 5000
const OG_MAX_BYTES = 65536
const OG_BLOCKED_HOSTS = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1|0\.0\.0\.0)/i

// Reject IPs that point at the loopback, private, link-local (incl. cloud
// metadata 169.254.169.254) or otherwise non-routable ranges. Guards SSRF
// even when a public hostname resolves to an internal address (DNS rebinding).
function isBlockedIp(address) {
  const version = isIP(address)
  if (!version) return true
  if (version === 4) {
    const parts = address.split('.').map(Number)
    const [a, b] = parts
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
    if (a >= 224) return true // multicast / reserved
    return false
  }
  const ip = address.toLowerCase()
  if (ip === '::1' || ip === '::') return true
  if (ip.startsWith('fe80') || ip.startsWith('fc') || ip.startsWith('fd')) return true // link-local / ULA
  if (ip.startsWith('::ffff:')) return isBlockedIp(ip.slice(7)) // IPv4-mapped
  return false
}

async function resolveOgHostToSafeIp(hostname) {
  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) throw new Error('Private address not allowed')
    return hostname
  }
  const records = await dnsLookup(hostname, { all: true })
  if (!records.length) throw new Error('Could not resolve host')
  for (const { address } of records) {
    if (isBlockedIp(address)) throw new Error('Private address not allowed')
  }
  return records[0].address
}

function parseOgTags(html) {
  const meta = {}
  const ogPropRe = /<meta\s+(?:[^>]*?\s)?(?:property|name)=["']og:([^"']+)["'][^>]*?content=["']([^"']*?)["'][^>]*?\/?>/gi
  const ogContRe = /<meta\s+(?:[^>]*?\s)?content=["']([^"']*?)["'][^>]*?(?:property|name)=["']og:([^"']+)["'][^>]*?\/?>/gi
  const titleRe = /<title[^>]*>([^<]{1,512})<\/title>/i
  const descRe = /<meta\s+(?:[^>]*?\s)?name=["']description["'][^>]*?content=["']([^"']{1,1024})["'][^>]*?\/?>/i
  const descCRe = /<meta\s+(?:[^>]*?\s)?content=["']([^"']{1,1024})["'][^>]*?name=["']description["'][^>]*?\/?>/i
  let m
  while ((m = ogPropRe.exec(html)) !== null) meta[m[1].toLowerCase()] = m[2]
  while ((m = ogContRe.exec(html)) !== null) meta[m[2].toLowerCase()] = meta[m[2].toLowerCase()] || m[1]
  if (!meta.title) { const t = titleRe.exec(html); if (t) meta.title = t[1].trim() }
  if (!meta.description) {
    const d = descRe.exec(html) || descCRe.exec(html)
    if (d) meta.description = d[1].trim()
  }
  return {
    title: meta.title?.slice(0, 512) || null,
    description: meta.description?.slice(0, 1024) || null,
    image: meta.image?.slice(0, 2048) || null,
    site: (meta['site_name'] || meta.site)?.slice(0, 128) || null,
  }
}

router.get('/api/og', requireAuth, async (request, response) => {
  const raw = String(request.query.url || '').trim()
  if (!raw) return response.status(400).json({ error: 'Missing url' })
  let parsed
  try { parsed = new URL(raw) } catch { return response.status(400).json({ error: 'Invalid url' }) }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return response.status(400).json({ error: 'Only http/https allowed' })
  }
  if (OG_BLOCKED_HOSTS.test(parsed.hostname)) {
    return response.status(400).json({ error: 'Private hosts not allowed' })
  }
  const cacheKey = raw
  const cached = ogCache.get(cacheKey)
  if (cached && Date.now() - cached.ts < OG_CACHE_TTL) {
    return response.json(cached.data)
  }
  let safeIp
  try {
    safeIp = await resolveOgHostToSafeIp(parsed.hostname)
  } catch {
    return response.status(400).json({ error: 'Private hosts not allowed' })
  }
  try {
    const mod = parsed.protocol === 'https:' ? await import('node:https') : await import('node:http')
    const data = await new Promise((resolve, reject) => {
      // Connect to the validated IP directly and pin the original hostname via
      // the Host header / TLS SNI, so a re-resolve can't swap in a private IP.
      const req = mod.get({
        protocol: parsed.protocol,
        host: safeIp,
        servername: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        headers: {
          'User-Agent': 'OndaBot/1.0 (+https://example.com/bot)',
          Accept: 'text/html',
          Host: parsed.host,
        },
        timeout: OG_FETCH_TIMEOUT,
      }, (res) => {
        if (res.statusCode >= 400) { res.destroy(); reject(new Error(`HTTP ${res.statusCode}`)); return }
        const ct = res.headers['content-type'] || ''
        if (!ct.includes('text/html') && !ct.includes('text/xml')) {
          res.destroy(); reject(new Error('Not HTML')); return
        }
        let buf = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          buf += chunk
          if (buf.length > OG_MAX_BYTES) { res.destroy(); resolve(buf) }
        })
        res.on('end', () => resolve(buf))
        res.on('error', reject)
      })
      req.on('error', reject)
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')) })
    })
    const tags = parseOgTags(data)
    const result = { url: raw, ...tags }
    ogCache.set(cacheKey, { ts: Date.now(), data: result })
    if (ogCache.size > 500) {
      const oldestKey = ogCache.keys().next().value
      ogCache.delete(oldestKey)
    }
    response.json(result)
  } catch {
    response.status(422).json({ error: 'Could not fetch preview' })
  }
})

export default router
