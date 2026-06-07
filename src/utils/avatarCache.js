let avatarBust = 0
const bustListeners = new Set()

export function bumpAvatarCache() {
  avatarBust = Date.now()
  bustListeners.forEach((fn) => fn(avatarBust))
}

export function getAvatarBust() {
  return avatarBust
}

export function subscribeAvatarBust(listener) {
  bustListeners.add(listener)
  return () => bustListeners.delete(listener)
}
