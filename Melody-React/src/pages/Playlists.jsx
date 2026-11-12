import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icons.jsx'
import { EmptyState, ErrorState, LoadingState } from '../components/States.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { createPlaylist, fetchPlaylists } from '../lib/db.js'
import { formatDate, plural } from '../lib/format.js'

/** Playlists - pages/playlists.php: list your playlists and create a new one. */
export default function Playlists() {
  const toast = useToast()
  const [state, setState] = useState('loading') // loading | ready | error
  const [error, setError] = useState('')
  const [playlists, setPlaylists] = useState([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setState('loading')
    setError('')
    fetchPlaylists()
      .then((rows) => {
        setPlaylists(rows)
        setState('ready')
      })
      .catch((err) => {
        setError(err?.message || 'Your playlists could not be loaded. Please try again.')
        setState('error')
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function create(e) {
    e.preventDefault()
    const value = name.trim()
    if (!value || busy) return
    setBusy(true)
    try {
      await createPlaylist(value)
      setName('')
      toast(`Created “${value}”.`)
      load()
    } catch (err) {
      toast(err?.message || 'Could not create the playlist.', true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="page">
      <h1 className="page-title">
        <Icon name="list-music" size={24} /> <span>Your Playlists</span>
      </h1>

      <form className="inline-form" onSubmit={create}>
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

      {state === 'loading' && <LoadingState label="Loading your playlists…" />}
      {state === 'error' && <ErrorState message={error} onRetry={load} />}

      {state === 'ready' &&
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
