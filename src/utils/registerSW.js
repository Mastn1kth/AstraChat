/**
 * Register the AstraChat service worker.
 * Called once from main.jsx after the app mounts.
 */
export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registration) => {
        // Listen for push messages from the SW (e.g., open-chat command)
        navigator.serviceWorker.addEventListener('message', (event) => {
          if (event.data?.type === 'open-chat' && event.data.chatId) {
            window.dispatchEvent(
              new CustomEvent('astrachat:open-chat', { detail: { chatId: event.data.chatId } }),
            )
          }
        })

        // Auto-update: if a new SW is waiting, activate it after a short delay
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing
          newWorker?.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New version available — notify via custom event so the UI can show a toast
              window.dispatchEvent(new CustomEvent('astrachat:update-ready'))
            }
          })
        })
      })
      .catch(() => {
        // SW registration failure is non-fatal
      })
  })
}
