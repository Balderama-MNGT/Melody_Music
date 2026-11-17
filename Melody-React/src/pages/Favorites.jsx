import { useEffect, useState } from 'react'
import { Icon } from '../components/Icons.jsx'
import TrackRow from '../components/TrackRow.jsx'
import { EmptyState, ErrorState, LoadingState } from '../components/States.jsx'
import { fetchFavoriteTracks } from '../lib/db.js'
import { providerSuffix } from '../lib/api.js'

/** Favorites - pages/favorites.php: every track you tapped the heart on. */
export default function Favorites() {
  const [state, setState] = useState('loading') // loading | ready | error
  const [error, setError] = useState('')
  const [tracks, setTracks] = useState([])

  useEffect(() => {
    let alive = true
    fetchFavoriteTracks()
      .then((rows) => {
        if (!alive) return
        setTracks(rows)
        setState('ready')
      })
      .catch((err) => {
        if (!alive) return
        setError(err?.message || 'Your favorites could not be loaded. Please try again.')
        setState('error')
      })
    return () => {
      alive = false
    }
  }, [])

  return (
    <section className="page">
      <h1 className="page-title">
        <Icon name="heart" size={24} /> <span>Your Favorites</span>
      </h1>

      {state === 'loading' && <LoadingState label="Loading your favorites…" />}
      {state === 'error' && <ErrorState message={error} />}

      {state === 'ready' &&
        (tracks.length === 0 ? (
          <EmptyState
            icon={<Icon name="heart" size={22} />}
            title="No favorites yet"
            text="Tap the heart on any song to save it here."
          />
        ) : (
          <ul className="track-list">
            {tracks.map((t, i) => (
              <TrackRow key={t.external_id} track={t} queue={tracks} index={i} suffix={providerSuffix(t.external_id)} />
            ))}
          </ul>
        ))}
    </section>
  )
}
