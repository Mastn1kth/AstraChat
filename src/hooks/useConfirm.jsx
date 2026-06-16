import { useState, useCallback } from 'react'

export function useConfirm() {
  const [state, setState] = useState(null)

  const confirm = useCallback(
    (message) =>
      new Promise((resolve) => {
        setState({ message, resolve })
      }),
    [],
  )

  function handleConfirm() {
    state?.resolve(true)
    setState(null)
  }

  function handleCancel() {
    state?.resolve(false)
    setState(null)
  }

  const dialog = state ? (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal confirm-modal">
        <p>{state.message}</p>
        <div className="modal-actions">
          <button type="button" onClick={handleCancel}>
            Cancel
          </button>
          <button type="button" className="primary-button danger" onClick={handleConfirm}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  ) : null

  return { confirm, dialog }
}
