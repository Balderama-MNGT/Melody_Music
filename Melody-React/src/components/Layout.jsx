import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Icon, BrandMark } from './Icons.jsx'
import Player from './Player.jsx'
import SearchBox from './SearchBox.jsx'
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
 * The authenticated shell: topbar (account), the sidebar (search + nav),
 * the page itself and the ever-present bottom player.
 * Port of includes/header.php, includes/sidebar.php and includes/footer.php.
 *
 * There is exactly one search field in the app and it lives in the sidebar,
 * so it is reachable from every page without a second box fighting it over
 * the same query.
 */
export default function Layout() {
  const { session, profile, signOut } = useAuth()
  const { playing } = usePlayer()
  const navigate = useNavigate()
  const location = useLocation()
  const [query, setQuery] = useState('')
  const [confirmingLogout, setConfirmingLogout] = useState(false)
  const [navOpen, setNavOpen] = useState(false)

  const closeNav = () => setNavOpen(false)

  /* Keep the sidebar box in step with the search page's ?q= value. */
  useEffect(() => {
    if (location.pathname === '/app/search') {
      setQuery(new URLSearchParams(location.search).get('q') || '')
    }
  }, [location.pathname, location.search])

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

  function goSearch(q) {
    // Submitting from the sidebar: the results replace whatever is on screen,
    // so on phones the drawer must get out of the way (the page it was opened
    // from keeps its pathname when only ?q= changes).
    setNavOpen(false)
    const target = q ? `/app/search?q=${encodeURIComponent(q)}` : '/app/search'
    /* The same query is already on screen: Enter twice in a row must not push
       a duplicate history entry (Back would then retrace the same page). */
    if (`${location.pathname}${location.search}` === target) return
    navigate(target)
  }

  async function logout() {
    setConfirmingLogout(false)
    // Land on the public page first (it owns the "logged out" popup), then
    // drop the session - arriving before RequireAuth can redirect to /login.
    navigate('/?logged_out=1')
    await signOut()
  }

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>

      <header className="topbar">
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

        {/* The app's only search field: suggestions while you type, Enter for
            the full results. It sits above the nav so it is on every page
            (and inside the drawer on phones, opened by the hamburger). */}
        <SearchBox
          value={query}
          onChange={setQuery}
          onSubmit={goSearch}
          inputId="sidebarSearch"
          placeholder="Search"
          showSubmit={false}
        />

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
  )
}
