import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

/**
 * Status messages shown above the bottom player (the PHP player's #toast).
 * Sits outside the player so every page and dialog can raise one.
 */
const ToastContext = createContext(null)

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null)
  const timer = useRef(null)

  const showToast = useCallback((message, isError = false) => {
    setToast({ message, isError })
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), isError ? 5000 : 2600)
  }, [])

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      <div
        className={toast ? `toast${toast.isError ? ' toast-error' : ''}` : 'toast'}
        role="status"
        aria-live="polite"
        hidden={!toast}
      >
        {toast?.message}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
