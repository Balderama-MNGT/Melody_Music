import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext.jsx'
import { ToastProvider } from './context/ToastContext.jsx'
import { FavoritesProvider } from './context/FavoritesContext.jsx'
import { PlayerProvider } from './context/PlayerContext.jsx'
import Layout from './components/Layout.jsx'
import Landing from './pages/Landing.jsx'
import Login from './pages/Login.jsx'
import Register from './pages/Register.jsx'
import Home from './pages/Home.jsx'
import Search from './pages/Search.jsx'
import Library from './pages/Library.jsx'
import Playlists from './pages/Playlists.jsx'
import PlaylistDetail from './pages/PlaylistDetail.jsx'
import Favorites from './pages/Favorites.jsx'
import Albums from './pages/Albums.jsx'
import History from './pages/History.jsx'
import Privacy from './pages/Privacy.jsx'

/** Shown while the stored session is being restored. */
function Booting() {
  return (
    <div className="page">
      <div className="music-state" role="status">
        <span className="spinner" aria-hidden="true" />
        <span>Loading Melody…</span>
      </div>
    </div>
  )
}

/** The app shell is for signed-in users only (index.php?app=1 in the PHP app). */
function RequireAuth({ children }) {
  const { isAuthenticated, loading } = useAuth()
  const location = useLocation()

  if (loading) return <Booting />
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }
  return children
}

/** Login / Register go straight to the app when a session already exists. */
function GuestOnly({ children }) {
  const { isAuthenticated, loading } = useAuth()
  if (loading) return <Booting />
  if (isAuthenticated) return <Navigate to="/app" replace />
  return children
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <FavoritesProvider>
          <PlayerProvider>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route
                path="/login"
                element={
                  <GuestOnly>
                    <Login />
                  </GuestOnly>
                }
              />
              <Route
                path="/register"
                element={
                  <GuestOnly>
                    <Register />
                  </GuestOnly>
                }
              />

              <Route
                path="/app"
                element={
                  <RequireAuth>
                    <Layout />
                  </RequireAuth>
                }
              >
                <Route index element={<Home />} />
                <Route path="search" element={<Search />} />
                <Route path="library" element={<Library />} />
                <Route path="playlists" element={<Playlists />} />
                <Route path="playlists/:id" element={<PlaylistDetail />} />
                <Route path="favorites" element={<Favorites />} />
                <Route path="albums" element={<Albums />} />
                <Route path="history" element={<History />} />
              </Route>

              <Route path="/privacy" element={<Privacy />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </PlayerProvider>
        </FavoritesProvider>
      </AuthProvider>
    </ToastProvider>
  )
}
