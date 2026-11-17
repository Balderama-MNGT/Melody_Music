import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icons.jsx'
import { EmptyState, ErrorState, LoadingState } from '../components/States.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { usePlaylists } from '../context/PlaylistsContext.jsx'
import { formatDate, plural } from '../lib/format.js'

/** Playlists - pages/playlists.php: list your playlists and create a new one. */
export default function Playlists() {
  const toast = useToast()
  const { playlists, loading, create, refresh } = usePlaylists()
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  async function createList(e) {
    e.preventDefault()
    const value = name.trim()
    if (!value || busy) return
    setBusy(true)
    setError('')
    try {
      await create(value)
      setName('')
      toast(`Created “${value}”.`)
    } catch (err) {
      setError(err?.message || 'Could not create the playlist.')
      refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="page">
      <h1 className="page-title">
        <Icon name="list-music" size={24} /> <span>Your Playlists</span>
      </h1>

      <form className="inline-form" onSubmit={createList}>
        <label className="visually-hidden" htmlFor="newPlaylist">
          New playlist name
        </label>
        <input
          type="text"
          id="newPlaylist"
          name="name"
          maxLength={100}
          placeholder="New playlist name..."
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={busy}>
          <Icon name="plus" size={16} /> <span>Create</span>
        </button>
      </form>

      {loading && <LoadingState label="Loading your playlists…" />}
      {!loading && error && <ErrorState message={error} onRetry={refresh} />}

      {!loading && !error &&
        (playlists.length === 0 ? (
          <EmptyState
            icon={<Icon name="list-music" size={22} />}
            title="No playlists yet"
            text="Create your first playlist above to start organizing your music."
          />
        ) : (
          <div className="card-grid">
            {playlists.map((pl) => (
              <Link className="list-card" to={`/app/playlists/${pl.id}`} key={pl.id}>
                <span className="list-card-icon" aria-hidden="true">
                  <Icon name="list-music" size={22} />
                </span>
                <div className="list-card-body">
                  <div className="list-card-title">{pl.name}</div>
                  <div className="list-card-sub">
                    {plural(pl.track_count, 'song', 'songs')} &bull; Created {formatDate(pl.created_at)}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        ))}
    </section>
  )
}
