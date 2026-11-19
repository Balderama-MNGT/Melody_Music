import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Icon, BrandMark } from './Icons.jsx'
import Player from './Player.jsx'
import ExpandedPlayer from './ExpandedPlayer.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'
import AccountMenu, { AccountAvatarButton } from './AccountMenu.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { usePlayer } from '../context/PlayerContext.jsx'
import { greeting } from '../lib/format.js'

const NAV_ITEMS = [
  { to: '/app', label: 'Home', icon: 'house', end: true },
  { to: '/app/search', label: 'Search', icon: 'search' },
  { to: '/app/library', label: 'Library', icon: 'library' },
  { to: '/app/playlists', label: 'Playlists', icon: 'list-music' },
  { to: '/app/favorites', label: 'Favorites', icon: 'heart' },
  { to: '/app/albums', label: 'Albums', icon: 'disc-3' },
  { to: '/app/history', label: 'History', icon: 'clock-3' },
]

/* Mobile has exactly four destinations. Account/settings/help live in the
   profile drawer, so nothing is duplicated here. */
const MOBILE_NAV = [NAV_ITEMS[0], NAV_ITEMS[1], NAV_ITEMS[2], NAV_ITEMS[3]]

/**
 * One authenticated shell with two presentations of the SAME routes/state:
 * - desktop: sidebar + topbar + main + bottom player
 * - mobile: compact page header + bottom navigation + mini-player above it
 */
export default function Layout() {
  const { session, profile, signOut } = useAuth()
  const { playing, expanded, hasVideo, hostRef, panelRef } = usePlayer()
  const navigate = useNavigate()
  const location = useLocation()
  const [confirmingLogout, setConfirmingLogout] = useState(false)
  /* `accountMounted` keeps the drawer in the DOM through its exit animation;
     `accountOpen` drives the CSS open state. Desktop dropdown is unaffected. */
  const [accountMounted, setAccountMounted] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [accountAnchor, setAccountAnchor] = useState(null)
  const accountTriggerRef = useRef(null)
  const accountTimerRef = useRef(0)

  const name =
    profile?.username ||
    session?.user?.user_metadata?.username ||
    session?.user?.email ||
    'there'
  const avatar =
    profile?.avatar_url ||
    session?.user?.user_metadata?.avatar_url ||
    session?.user?.user_metadata?.picture ||
    ''

  const currentNav = NAV_ITEMS.find(
    (item) =>
      (item.end && location.pathname === item.to) ||
      (!item.end && location.pathname.startsWith(item.to))
  )
  const mobileTitle = location.pathname === '/app' ? `${greeting()}, ${name}` : currentNav?.label || 'Melody'

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  function closeAccount() {
    setAccountOpen(false)
    clearTimeout(accountTimerRef.current)
    /* Only the mobile drawer needs an exit animation; the desktop dropdown
       keeps its original immediate close behaviour. */
    const mobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
    if (mobile) accountTimerRef.current = setTimeout(() => setAccountMounted(false), 320)
    else setAccountMounted(false)
  }

  useEffect(() => {
    if (accountMounted) closeAccount()
  }, [location.pathname])

  useEffect(() => {
    if (expanded && accountMounted) closeAccount()
  }, [expanded])

  useEffect(() => {
    const onResize = () => {
      if (accountMounted) closeAccount()
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      clearTimeout(accountTimerRef.current)
    }
  }, [accountMounted])

  function openAccount(e) {
    if (accountOpen) {
      closeAccount()
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    accountTriggerRef.current = e.currentTarget
    setAccountAnchor({ bottom: rect.bottom, right: rect.right })
    clearTimeout(accountTimerRef.current)
    setAccountMounted(true)
    /* Next frame so the base (closed) styles paint before the open class. */
    requestAnimationFrame(() => setAccountOpen(true))
  }

  async function logout() {
    setConfirmingLogout(false)
    closeAccount()
    // Land on the public page first (it owns the "logged out" popup), then
    // drop the session - arriving before RequireAuth can redirect to /login.
    navigate('/?logged_out=1')
    await signOut()
  }

  return (
    <>
      <div className="app">
        <a className="skip-link" href="#main">
          Skip to main content
        </a>

        {/* Compact mobile page header (hidden on desktop by CSS). */}
        <header className="mobile-page-header">
          <AccountAvatarButton
            name={name}
            src={avatar}
            onClick={openAccount}
            buttonRef={accountTriggerRef}
            className="mobile-account-trigger"
          />
          <h1>{mobileTitle}</h1>
        </header>

        <header className="topbar">
          <div className="topbar-user">
            <span className="topbar-greeting">
              Hi, <strong>{name}</strong>
            </span>
            <AccountAvatarButton
              name={name}
              src={avatar}
              onClick={openAccount}
              buttonRef={accountTriggerRef}
            />
            <button
              type="button"
              className="btn btn-outline btn-logout"
              onClick={() => setConfirmingLogout(true)}
            >
              <Icon name="log-out" size={16} />
              <span>Logout</span>
            </button>
          </div>
        </header>

        <aside className="sidebar" id="appSidebar">
          <div className="sidebar-head">
            <Link className="logo" to="/app" aria-label="Melody - home">
              <BrandMark size={24} />
              <span className="logo-text">Melody</span>
            </Link>
          </div>

          <nav className="nav" aria-label="Main navigation">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
              >
                <Icon name={item.icon} size={20} className="nav-icon" />
                <span className="nav-label">{item.label}</span>
              </NavLink>
            ))}
          </nav>

          {/* Required notices for YouTube API Services clients. */}
          <div className="sidebar-legal">
            <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener">
              YouTube Terms of Service
            </a>
            <Link to="/privacy">
              Privacy &amp; Terms
            </Link>
          </div>
        </aside>

        <main className="main" id="main">
          <Outlet />
        </main>

        <Player />

        {/* Mobile bottom navigation. Search routes through state so the Search
            page focuses its own existing input. */}
        <nav className="mobile-bottom-nav" aria-label="Primary navigation">
          {MOBILE_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `mobile-nav-item${isActive ? ' active' : ''}`}
              onClick={
                item.to === '/app/search'
                  ? (e) => {
                      e.preventDefault()
                      navigate('/app/search', { state: { focusSearch: true } })
                    }
                  : undefined
              }
            >
              <Icon name={item.icon} size={22} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {confirmingLogout && (
          <ConfirmDialog
            title="Log out of Melody?"
            message={
              playing
                ? 'Your music will stop playing and you will be signed out on this device.'
                : 'You will be signed out on this device. You can log back in anytime.'
            }
            confirmText="Log out"
            cancelText="Stay logged in"
            onConfirm={logout}
            onCancel={() => setConfirmingLogout(false)}
          />
        )}
      </div>

      {accountMounted && (
        <AccountMenu
          name={name}
          src={avatar}
          open={accountOpen}
          anchorRect={accountAnchor}
          onClose={closeAccount}
          onLogout={() => {
            closeAccount()
            setConfirmingLogout(true)
          }}
          triggerRef={accountTriggerRef}
        />
      )}

      {/* The ONE YouTube player, mounted for the whole session. */}
      <div className="yt-panel" hidden={!hasVideo} ref={panelRef}>
        <div className="yt-host" ref={hostRef} />
      </div>

      {expanded && <ExpandedPlayer />}
    </>
  )
}
