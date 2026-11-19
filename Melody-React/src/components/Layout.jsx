import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Icon, BrandMark } from './Icons.jsx'
import Player from './Player.jsx'
import ExpandedPlayer from './ExpandedPlayer.jsx'
import ConfirmDialog from './ConfirmDialog.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { usePlayer } from '../context/PlayerContext.jsx'

const NAV_ITEMS = [
  { to: '/app', label: 'Home', icon: 'house', end: true },
  { to: '/app/search', label: 'Search', icon: 'search' },
  { to: '/app/library', label: 'Library', icon: 'library' },
  { to: '/app/playlists', label: 'Playlists', icon: 'list-music' },
  { to: '/app/favorites', label: 'Favorites', icon: 'heart' },
  { to: '/app/albums', label: 'Albums', icon: 'disc-3' },
  { to: '/app/history', label: 'History', icon: 'clock-3' },
]

/**
 * The authenticated shell: topbar (search shortcut + account), the sidebar
 * (logo + nav), the page itself and the ever-present bottom player.
 * Port of includes/header.php, includes/sidebar.php and includes/footer.php.
 *
 * The topbar input is only a shortcut: it hands the query to the existing
 * Search page via ?q= and asks that page to focus its own input. There is one
 * search implementation and one source of truth (the URL on the Search page).
 */
export default function Layout() {
  const { session, profile, signOut } = useAuth()
  const { playing, expanded, hasVideo, hostRef, panelRef } = usePlayer()
  const navigate = useNavigate()
  const location = useLocation()
  const [confirmingLogout, setConfirmingLogout] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const [topQuery, setTopQuery] = useState('')

  const closeNav = () => setNavOpen(false)

  /** The header field never searches on its own: it routes to the one Search
      page and asks that page to focus its existing input. */
  function openSearch(value = '') {
    const q = String(value || '').trim()
    setTopQuery('')
    navigate(q ? `/app/search?q=${encodeURIComponent(q)}` : '/app/search', {
      state: { focusSearch: true },
    })
  }

  /* A new page starts at the top, like nav.js did. */
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  /* The mobile drawer closes itself on navigation, on Escape, while it is
     open (the page behind must not scroll), and when the viewport grows back
     to the desktop layout where the sidebar is always visible. */
  useEffect(() => {
    setNavOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!navOpen) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') setNavOpen(false)
    }
    const media = window.matchMedia('(min-width: 861px)')
    const onWide = (e) => {
      if (e.matches) setNavOpen(false)
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey)
    media.addEventListener('change', onWide)
    return () => {
      document.removeEventListener('keydown', onKey)
      media.removeEventListener('change', onWide)
      document.body.style.overflow = previousOverflow
    }
  }, [navOpen])

  const name =
    profile?.username ||
    session?.user?.user_metadata?.username ||
    session?.user?.email ||
    'there'

  async function logout() {
    setConfirmingLogout(false)
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

      <header className="topbar">
        {/* Left: the menu button (phones) plus a shortcut to the ONE Search
            page. Empty click focuses the page's own input; Enter searches. */}
        <div className="topbar-left">
          <button
            type="button"
            className="btn btn-icon nav-toggle"
            aria-label="Open navigation menu"
            aria-expanded={navOpen}
            aria-controls="appSidebar"
            onClick={() => setNavOpen(true)}
          >
            <Icon name="menu" size={22} />
          </button>
          <form
            className="topbar-search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault()
              openSearch(topQuery)
            }}
          >
            <span className="topbar-search-icon" aria-hidden="true">
              <Icon name="search" size={18} />
            </span>
            <label className="visually-hidden" htmlFor="topbarSearch">
              Search songs, artists, albums
            </label>
            <input
              id="topbarSearch"
              type="text"
              className="topbar-search-input"
              placeholder="Search songs, artists, albums..."
              value={topQuery}
              onChange={(e) => setTopQuery(e.target.value)}
              onClick={() => {
                if (!topQuery.trim()) openSearch('')
              }}
              autoComplete="off"
            />
          </form>
        </div>

        <div className="topbar-user">
          <span className="topbar-greeting">
            Hi, <strong>{name}</strong>
          </span>
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

      {/* Tapping the dimmed area closes the mobile drawer. */}
      {navOpen && <div className="nav-backdrop" onClick={closeNav} aria-hidden="true" />}

      <aside className={`sidebar${navOpen ? ' is-open' : ''}`} id="appSidebar">
        <div className="sidebar-head">
          <Link className="logo" to="/app" aria-label="Melody - home" onClick={closeNav}>
            <BrandMark size={24} />
            <span className="logo-text">Melody</span>
          </Link>
          <button
            type="button"
            className="btn btn-icon nav-close"
            aria-label="Close navigation menu"
            onClick={closeNav}
          >
            <Icon name="x" size={20} />
          </button>
        </div>

        <nav className="nav" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={closeNav}
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
          <Link to="/privacy" onClick={closeNav}>
            Privacy &amp; Terms
          </Link>
        </div>
      </aside>

      <main className="main" id="main">
        <Outlet />
      </main>

      <Player />

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

      {/* The ONE YouTube player, mounted for the whole session. It lives
          outside .app so hiding the dashboard while expanded never hides the
          iframe, and the expanded view owns the document's scroll height. */}
      <div className="yt-panel" hidden={!hasVideo} ref={panelRef}>
        <div className="yt-host" ref={hostRef} />
      </div>

      {expanded && <ExpandedPlayer />}
    </>
  )
}
