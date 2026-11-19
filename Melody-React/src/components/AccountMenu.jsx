import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Icon } from './Icons.jsx'

/** Reusable avatar trigger: a real button so keyboard and screen readers work. */
export function AccountAvatarButton({ name, src, onClick, buttonRef, className = '' }) {
  const initial = String(name || '?').trim().charAt(0).toUpperCase() || '?'
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`account-avatar-button ${className}`.trim()}
      aria-label="Open account menu"
      aria-haspopup="menu"
      onClick={onClick}
    >
      {src ? (
        <img className="user-avatar" src={src} alt="" referrerPolicy="no-referrer" />
      ) : (
        <span className="user-avatar user-avatar-ph" aria-hidden="true">
          {initial}
        </span>
      )}
    </button>
  )
}

/* No duplicated navigation: Favorites/Albums/History stay in the sidebar and
   mobile bottom nav. These are account-only preferences and information. */
const PREFERENCES = [
  { to: '/app/settings#appearance', label: 'Appearance', icon: 'sun', hint: 'Light, dark or system' },
  { to: '/app/settings#playback', label: 'Playback Preferences', icon: 'play', hint: 'Shuffle and repeat' },
]
const SUPPORT = [
  { to: '/app/help', label: 'Help & Support', icon: 'help-circle', hint: 'How to use Melody' },
  { to: '/privacy', label: 'Privacy & Terms', icon: 'check', hint: 'Policies and legal' },
  { to: '/app/about', label: 'About Melody', icon: 'info', hint: 'Version and credits' },
]

function useIsMobile() {
  const [mobile, setMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
  )
  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)')
    const onChange = (e) => setMobile(e.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return mobile
}

/**
 * Account & Preferences Center. Mobile is a full slide-out drawer (Logout at
 * the bottom); desktop is a compact dropdown anchored to the avatar with no
 * Logout, because the header already has one. Both are portalled above the
 * YouTube iframe; the player itself is never touched.
 */
export default function AccountMenu({ name, src, open, anchorRect, onClose, onLogout, triggerRef }) {
  const mobile = useIsMobile()
  const panelRef = useRef(null)

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    document.body.classList.add('account-open')
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.body.classList.remove('account-open')
      document.removeEventListener('keydown', onKey, true)
      triggerRef?.current?.focus?.()
    }
  }, [onClose, triggerRef])

  useEffect(() => {
    panelRef.current?.focus?.()
  }, [])

  const style = !mobile && anchorRect
    ? {
        top: Math.min(anchorRect.bottom + 8, window.innerHeight - 12),
        left: Math.max(8, Math.min(anchorRect.right - 300, window.innerWidth - 308)),
      }
    : undefined

  const initial = String(name || '?').trim().charAt(0).toUpperCase() || '?'

  const renderGroup = (title, items) => (
    <div className="account-group">
      <span className="account-group-label">{title}</span>
      {items.map((item) => (
        <Link key={item.to} to={item.to} className="account-link" onClick={onClose}>
          <Icon name={item.icon} size={19} />
          <span className="account-link-text">
            <strong>{item.label}</strong>
            <small>{item.hint}</small>
          </span>
          <Icon name="chevron-right" size={15} className="account-chevron" />
        </Link>
      ))}
    </div>
  )

  return createPortal(
    <>
      <div
        className={`account-backdrop${open ? ' is-open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        className={`${mobile ? 'account-drawer' : 'account-dropdown'}${open ? ' is-open' : ''}`}
        role="menu"
        aria-label="Account menu"
        tabIndex={-1}
        style={style}
      >
        <div className="account-profile">
          {src ? (
            <img className="user-avatar account-avatar" src={src} alt="" referrerPolicy="no-referrer" />
          ) : (
            <span className="user-avatar user-avatar-ph account-avatar" aria-hidden="true">
              {initial}
            </span>
          )}
          <span className="account-profile-text">
            <strong>{name}</strong>
            <span>Melody Account</span>
          </span>
        </div>

        <div className="account-body">
          {renderGroup('Preferences', PREFERENCES)}
          {renderGroup('Support & Information', SUPPORT)}
        </div>

        {/* Only the mobile drawer has Logout - the desktop header keeps its own. */}
        {mobile && (
          <button type="button" className="account-logout" onClick={onLogout}>
            <Icon name="log-out" size={20} />
            <span>Logout</span>
          </button>
        )}
      </div>
    </>,
    document.body
  )
}
