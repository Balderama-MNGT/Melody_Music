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
 * The authenticated shell: topbar (search + account), sidebar navigation,
 * the page itself and the ever-present bottom player.
 * Port of includes/header.php, includes/sidebar.php and includes/footer.php.
 */
export default function Layout() {
  const { session, profile, signOut } = useAuth()
  const { playing } = usePlayer()
  const navigate = useNavigate()
  const location = useLocation()
  const [query, setQuery] = useState('')
  const [confirmingLogout, setConfirmingLogout] = useState(false)

  /* Keep the topbar box in step with the search page's ?q= value. */
  useEffect(() => {
    if (location.pathname === '/app/search') {
      setQuery(new URLSearchParams(location.search).get('q') || '')
    }
  }, [location.pathname, location.search])

  /* A new page starts at the top, like nav.js did. */
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  const name =
    profile?.username ||
    session?.user?.user_metadata?.username ||
    session?.user?.email ||
    'there'

  function goSearch(q) {
    navigate(q ? `/app/search?q=${encodeURIComponent(q)}` : '/app/search')
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
        <SearchBox value={query} onChange={setQuery} onSubmit={goSearch} inputId="topbarSearch" />

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

      <aside className="sidebar">
        <Link className="logo" to="/app" aria-label="Melody - home">
          <BrandMark size={24} />
          <span className="logo-text">Melody</span>
        </Link>

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
