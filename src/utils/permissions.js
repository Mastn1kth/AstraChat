import { enableWebPushNotifications } from './push'

export const PERMISSION_ONBOARDING_KEY = 'onda.permissions.onboarding.v1'

export function hasCompletedPermissionOnboarding() {
  if (typeof window === 'undefined') return true
  try {
    return window.localStorage.getItem(PERMISSION_ONBOARDING_KEY) === 'done'
  } catch {
    return true
  }
}

export function markPermissionOnboardingComplete() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(PERMISSION_ONBOARDING_KEY, 'done')
  } catch {
    // Private browsing can block storage; failing closed avoids a prompt loop.
  }
}

async function requestMediaPermission(constraints) {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return 'unsupported'
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints)
    stream.getTracks().forEach((track) => track.stop())
    return 'granted'
  } catch (error) {
    if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') {
      return 'denied'
    }
    if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') {
      return 'missing-device'
    }
    return 'unavailable'
  }
}

export async function requestNotificationAccess() {
  try {
    const result = await enableWebPushNotifications()
    return result.enabled ? 'granted' : result.reason || 'unavailable'
  } catch {
    return 'unavailable'
  }
}

export async function requestCorePermissions() {
  const notifications = await requestNotificationAccess()
  const microphone = await requestMediaPermission({ audio: true })
  const camera = await requestMediaPermission({ video: true })
  return { notifications, microphone, camera }
}
