// Firebase Cloud Messaging (HTTP v1) sender for native mobile push.
// Configure with a service-account JSON via FCM_SERVICE_ACCOUNT_JSON (inline)
// or FCM_SERVICE_ACCOUNT_FILE (path). When not configured, FCM is disabled
// and only Web Push (VAPID) is used.
import { createSign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import logger from './logger.js'

function loadServiceAccount() {
  try {
    if (process.env.FCM_SERVICE_ACCOUNT_JSON) {
      return JSON.parse(process.env.FCM_SERVICE_ACCOUNT_JSON)
    }
    if (process.env.FCM_SERVICE_ACCOUNT_FILE) {
      return JSON.parse(readFileSync(process.env.FCM_SERVICE_ACCOUNT_FILE, 'utf8'))
    }
  } catch (error) {
    logger.warn({ err: error.message }, '[fcm] invalid service account config')
  }
  return null
}

const serviceAccount = loadServiceAccount()

export function isFcmEnabled() {
  return Boolean(serviceAccount?.client_email && serviceAccount?.private_key && serviceAccount?.project_id)
}

let cachedToken = ''
let cachedTokenExpiresAt = 0

function base64Url(input) {
  return Buffer.from(input).toString('base64url')
}

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiresAt - 60000) return cachedToken

  const now = Math.floor(Date.now() / 1000)
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64Url(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  )
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claims}`)
  const signature = signer.sign(serviceAccount.private_key, 'base64url')
  const assertion = `${header}.${claims}.${signature}`

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  const data = await response.json()
  if (!response.ok || !data.access_token) {
    throw new Error(`FCM auth failed: ${data.error_description || response.status}`)
  }
  cachedToken = data.access_token
  cachedTokenExpiresAt = Date.now() + Number(data.expires_in || 3600) * 1000
  return cachedToken
}

// Returns { ok, unregistered } — unregistered means the token should be deleted.
export async function sendFcmMessage(token, { title, body, data = {} }) {
  if (!isFcmEnabled()) return { ok: false, unregistered: false }
  const accessToken = await getAccessToken()
  const response = await fetch(
    `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body },
          data: Object.fromEntries(
            Object.entries(data).map(([key, value]) => [key, String(value)]),
          ),
          android: { priority: 'high' },
          apns: { headers: { 'apns-priority': '10' } },
        },
      }),
    },
  )
  if (response.ok) return { ok: true, unregistered: false }
  const payload = await response.json().catch(() => ({}))
  const code = payload?.error?.details?.find((d) => d.errorCode)?.errorCode || payload?.error?.status
  return { ok: false, unregistered: code === 'UNREGISTERED' || response.status === 404 }
}
