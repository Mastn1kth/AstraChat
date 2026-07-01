import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REQUIRED_S3_KEYS = ['S3_BUCKET', 'S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']

export function parseEnvFile(text) {
  const env = {}
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const equalsIndex = line.indexOf('=')
    if (equalsIndex <= 0) continue
    const key = line.slice(0, equalsIndex).trim()
    let value = line.slice(equalsIndex + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

function isSet(env, key) {
  return String(env[key] || '').trim().length > 0
}

function addRequired(failures, env, key, reason = 'is required') {
  if (!isSet(env, key)) failures.push(`${key} ${reason}`)
}

function validateBase64Key(failures, env, key, expectedBytes) {
  if (!isSet(env, key)) return
  const buffer = Buffer.from(env[key], 'base64')
  if (buffer.length !== expectedBytes || buffer.toString('base64').replace(/=+$/g, '') !== String(env[key]).replace(/=+$/g, '')) {
    failures.push(`${key} must be a base64-encoded ${expectedBytes}-byte key`)
  }
}

function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function configuredIceServers(env, failures) {
  if (isSet(env, 'WEBRTC_ICE_SERVERS')) {
    try {
      const parsed = JSON.parse(env.WEBRTC_ICE_SERVERS)
      if (!Array.isArray(parsed)) {
        failures.push('WEBRTC_ICE_SERVERS must be a JSON array')
        return []
      }
      return parsed.flatMap((server) => Array.isArray(server.urls) ? server.urls : [server.urls]).filter(Boolean)
    } catch (error) {
      failures.push(`WEBRTC_ICE_SERVERS is invalid JSON: ${error.message}`)
      return []
    }
  }
  return [...parseCsv(env.WEBRTC_STUN_URLS), ...parseCsv(env.WEBRTC_TURN_URLS)]
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function isValidUrlWithProtocols(value, protocols) {
  try {
    return protocols.includes(new URL(value).protocol)
  } catch {
    return false
  }
}

function validateTtl(failures, env, key) {
  if (!isSet(env, key)) return
  const value = Number(env[key])
  if (!Number.isFinite(value) || value < 30 || value > 3600) {
    failures.push(`${key} must be between 30 and 3600 seconds`)
  }
}

export function checkProductionEnv(env) {
  const failures = []
  const warnings = []

  if (env.NODE_ENV !== 'production') {
    failures.push('NODE_ENV must be production')
  }

  for (const key of ['DATABASE_URL', 'REDIS_URL', 'MESSAGE_ENCRYPTION_KEY']) {
    addRequired(failures, env, key)
  }

  if (isSet(env, 'DATABASE_URL') && !/^postgres(ql)?:\/\//.test(env.DATABASE_URL)) {
    failures.push('DATABASE_URL must start with postgres:// or postgresql://')
  }
  if (isSet(env, 'REDIS_URL') && !/^rediss?:\/\//.test(env.REDIS_URL)) {
    failures.push('REDIS_URL must start with redis:// or rediss://')
  }
  validateBase64Key(failures, env, 'MESSAGE_ENCRYPTION_KEY', 32)

  if ((env.STORAGE_DRIVER || 'local') !== 's3') {
    failures.push('STORAGE_DRIVER must be s3 in production')
  }
  for (const key of REQUIRED_S3_KEYS) addRequired(failures, env, key, 'is required for S3 storage')
  if (isSet(env, 'S3_ENDPOINT') && !isValidUrlWithProtocols(env.S3_ENDPOINT, ['https:', 'http:'])) {
    failures.push('S3_ENDPOINT must be a valid http:// or https:// URL')
  }
  if (isSet(env, 'S3_ENDPOINT') && !isHttpsUrl(env.S3_ENDPOINT)) {
    warnings.push('S3_ENDPOINT is not https://; only use this behind a trusted private network')
  }

  for (const key of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']) {
    addRequired(failures, env, key)
  }
  if (
    isSet(env, 'VAPID_SUBJECT') &&
    !env.VAPID_SUBJECT.startsWith('mailto:') &&
    !env.VAPID_SUBJECT.startsWith('https://')
  ) {
    failures.push('VAPID_SUBJECT must start with mailto: or https://')
  }

  if (!isSet(env, 'FCM_SERVICE_ACCOUNT_JSON') && !isSet(env, 'FCM_SERVICE_ACCOUNT_FILE')) {
    failures.push('FCM_SERVICE_ACCOUNT_JSON or FCM_SERVICE_ACCOUNT_FILE is required for native push')
  }
  if (isSet(env, 'FCM_SERVICE_ACCOUNT_JSON')) {
    try {
      JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON)
    } catch {
      failures.push('FCM_SERVICE_ACCOUNT_JSON must be valid JSON')
    }
  }

  const sameSite = String(env.SESSION_COOKIE_SAME_SITE || 'lax').toLowerCase()
  if (!['lax', 'strict', 'none'].includes(sameSite)) {
    failures.push('SESSION_COOKIE_SAME_SITE must be lax, strict or none')
  }
  const cookieSecure = !isSet(env, 'SESSION_COOKIE_SECURE') ? true : env.SESSION_COOKIE_SECURE === 'true'
  if (sameSite === 'none' && !cookieSecure) {
    failures.push('SESSION_COOKIE_SAME_SITE=none requires SESSION_COOKIE_SECURE=true')
  }
  if (sameSite !== 'none' && String(env.ALLOWED_ORIGINS || '').includes('capacitor://')) {
    warnings.push('Capacitor origins usually require SESSION_COOKIE_SAME_SITE=none and SESSION_COOKIE_SECURE=true')
  }

  const origins = parseCsv(env.ALLOWED_ORIGINS)
  if (!origins.length) {
    failures.push('ALLOWED_ORIGINS is required in production')
  }
  for (const origin of origins) {
    if (
      !origin.startsWith('https://') &&
      !origin.startsWith('capacitor://') &&
      !origin.startsWith('http://localhost')
    ) {
      failures.push(`ALLOWED_ORIGINS contains an unsafe origin: ${origin}`)
    }
  }

  const iceUrls = configuredIceServers(env, failures)
  if (!iceUrls.some((url) => /^turns?:/.test(String(url)))) {
    failures.push('Production WebRTC requires at least one TURN/TURNS URL')
  }
  if (iceUrls.some((url) => /^turns?:/.test(String(url)))) {
    if (!isSet(env, 'WEBRTC_TURN_USERNAME') || !isSet(env, 'WEBRTC_TURN_CREDENTIAL')) {
      failures.push('TURN server requires WEBRTC_TURN_USERNAME and WEBRTC_TURN_CREDENTIAL')
    }
  }
  const groupMediaMode = String(env.WEBRTC_GROUP_MEDIA_MODE || 'mesh').toLowerCase()
  if (!['mesh', 'sfu', 'mcu'].includes(groupMediaMode)) {
    failures.push('WEBRTC_GROUP_MEDIA_MODE must be mesh, sfu or mcu')
  }
  if (groupMediaMode !== 'mesh') {
    addRequired(failures, env, 'WEBRTC_MEDIA_SERVER_URL', 'is required for SFU/MCU group calls')
  }
  if (isSet(env, 'WEBRTC_MEDIA_SERVER_URL') && !isHttpsUrl(env.WEBRTC_MEDIA_SERVER_URL)) {
    failures.push('WEBRTC_MEDIA_SERVER_URL must start with https://')
  }
  validateTtl(failures, env, 'WEBRTC_MEDIA_SERVER_TOKEN_TTL_SECONDS')

  if (isSet(env, 'MEDIA_CDN_URL') && !isHttpsUrl(env.MEDIA_CDN_URL)) {
    failures.push('MEDIA_CDN_URL must start with https://')
  }
  validateTtl(failures, env, 'MEDIA_CDN_TOKEN_TTL_SECONDS')

  if (isSet(env, 'PORT')) {
    const port = Number(env.PORT)
    if (!Number.isInteger(port) || port <= 0 || port > 65535) failures.push('PORT must be a valid TCP port')
  }

  return { failures, warnings }
}

function loadEnvFile(path) {
  if (!existsSync(path)) {
    throw new Error(`Environment file not found: ${path}`)
  }
  return parseEnvFile(readFileSync(path, 'utf8'))
}

function readArgs(argv) {
  const envArg = argv.find((item) => item.startsWith('--env='))
  return {
    envFile: resolve(process.cwd(), envArg ? envArg.slice('--env='.length) : '.env.production'),
  }
}

export function formatCheckResult({ envFile, failures, warnings }) {
  const lines = [`Production environment check: ${envFile}`]
  if (failures.length) {
    lines.push('', 'Failures:')
    for (const failure of failures) lines.push(`- ${failure}`)
  }
  if (warnings.length) {
    lines.push('', 'Warnings:')
    for (const warning of warnings) lines.push(`- ${warning}`)
  }
  if (!failures.length && !warnings.length) lines.push('', 'OK: production environment looks complete.')
  if (!failures.length && warnings.length) lines.push('', 'OK with warnings.')
  return lines.join('\n')
}

async function main() {
  const { envFile } = readArgs(process.argv.slice(2))
  const fileEnv = loadEnvFile(envFile)
  const env = { ...process.env, ...fileEnv }
  const result = checkProductionEnv(env)
  console.log(formatCheckResult({ envFile, ...result }))
  if (result.failures.length) process.exitCode = 1
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])
if (isDirectRun) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
