import { useEffect, useRef } from 'react'

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/**
 * Traps keyboard focus inside a modal/dialog while it is open:
 * - moves focus into the dialog on mount
 * - Tab/Shift+Tab cycle within the dialog instead of escaping to the page
 * - Escape calls onClose
 * - focus returns to the element that had it before the dialog opened, on unmount
 *
 * Usage: const ref = useFocusTrap(onClose); <div ref={ref} role="dialog"> ... </div>
 */
export function useFocusTrap(onClose, { active = true } = {}) {
  const containerRef = useRef(null)
  const previousFocusRef = useRef(null)

  useEffect(() => {
    if (!active) return undefined
    const container = containerRef.current
    if (!container) return undefined

    previousFocusRef.current = document.activeElement

    function focusables() {
      return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      )
    }

    const initial = focusables()[0]
    if (initial) {
      initial.focus()
    } else {
      container.setAttribute('tabindex', '-1')
      container.focus()
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose?.()
        return
      }
      if (event.key !== 'Tab') return
      const items = focusables()
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    container.addEventListener('keydown', handleKeyDown)
    return () => {
      container.removeEventListener('keydown', handleKeyDown)
      const toRestore = previousFocusRef.current
      if (toRestore && typeof toRestore.focus === 'function') {
        toRestore.focus()
      }
    }
  }, [active, onClose])

  return containerRef
}
