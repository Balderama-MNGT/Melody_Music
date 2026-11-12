import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

/**
 * Confirm popup - a port of MelodyUI.confirm() from assets/js/dialogs.js.
 * Esc / clicking outside cancel, Tab stays inside the two buttons.
 */
export default function ConfirmDialog({
  title = 'Are you sure?',
  message = '',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  icon,
  onConfirm,
  onCancel,
}) {
  const cancelRef = useRef(null)
  const okRef = useRef(null)

  useEffect(() => {
    const opener = document.activeElement
    okRef.current?.focus()

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
        return
      }
      if (e.key !== 'Tab') return
      const items = [cancelRef.current, okRef.current].filter(Boolean)
      const i = items.indexOf(document.activeElement)
      e.preventDefault()
      if (e.shiftKey) items[i <= 0 ? items.length - 1 : i - 1]?.focus()
      else items[i === items.length - 1 ? 0 : i + 1]?.focus()
    }

    document.addEventListener('keydown', onKey, true)
    document.body.classList.add('dlg-open')

    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.body.classList.remove('dlg-open')
      if (opener && document.body.contains(opener) && opener.focus) opener.focus()
    }
  }, [onCancel])

  const defaultIcon = (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" x2="9" y1="12" y2="12" />
    </svg>
  )

  return createPortal(
    <div
      className="dlg-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div className="dlg-box" role="alertdialog" aria-modal="true" aria-labelledby="dlgTitle" aria-describedby="dlgText">
        <div className="dlg-icon" aria-hidden="true">
          {icon || defaultIcon}
        </div>
        <h2 id="dlgTitle">{title}</h2>
        <p className="dlg-text" id="dlgText">
          {message}
        </p>
        <div className="dlg-actions">
          <button ref={cancelRef} type="button" className="btn btn-outline" onClick={onCancel}>
            {cancelText}
          </button>
          <button ref={okRef} type="button" className="btn btn-primary" onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
