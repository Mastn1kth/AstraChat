import { Capacitor } from '@capacitor/core'
import {
  deletePushSubscription,
  getPushVapidPublicKey,
  saveFcmToken,
  savePushSubscription,
} from '../api/client'
import { ensureNotificationPermission } from './notify'

// In the Capacitor shell Web Push does not work — register through the
// native push plugin (FCM on Android, APNs via FCM on iOS) instead.
async function enableNativePush() {
  const { PushNotifications } = await import('@capacitor/push-notifications')
  const permission = await PushNotifications.requestPermissions()
  if (permission.receive !== 'granted') return { enabled: false, reason: 'permission' }

  return new Promise((resolve) => {
    PushNotifications.addListener('registration', async ({ value }) => {
      try {
        await saveFcmToken(value)
        resolve({ enabled: true })
      } catch (error) {
        resolve({ enabled: false, reason: error.message || 'server' })
      }
    })
    PushNotifications.addListener('registrationError', () => {
      resolve({ enabled: false, reason: 'register' })
    })
    PushNotifications.register()
  })
}

function base64UrlToUint8Array(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4)
  const base64 = `${value}${padding}`.replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)))
}

function canUsePush() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    window.isSecureContext
  )
}

export async function enableWebPushNotifications() {
  if (Capacitor.isNativePlatform()) return enableNativePush()
  if (!canUsePush()) return { enabled: false, reason: 'unsupported' }
  if (!(await ensureNotificationPermission())) return { enabled: false, reason: 'permission' }

  const { enabled, publicKey } = await getPushVapidPublicKey()
  if (!enabled || !publicKey) return { enabled: false, reason: 'server' }

  const registration = await navigator.serviceWorker.ready
  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(publicKey),
    })
  }
  await savePushSubscription(subscription.toJSON())
  return { enabled: true }
}

export async function disableWebPushNotifications() {
  if (!canUsePush()) {
    await deletePushSubscription().catch(() => {})
    return
  }

  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
  if (subscription) {
    await deletePushSubscription(subscription.endpoint).catch(() => {})
    await subscription.unsubscribe().catch(() => {})
    return
  }
  await deletePushSubscription().catch(() => {})
}
