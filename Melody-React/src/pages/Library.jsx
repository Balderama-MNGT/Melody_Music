import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icons.jsx'
import TrackRow from '../components/TrackRow.jsx'
import { EmptyState, ErrorState, LoadingState } from '../components/States.jsx'
import { fetchLibraryBundle } from '../lib/db.js'
import { providerSuffix } from '../lib/api.js'
import { plural } from '../lib/format.js'

/** "Oct 24, 14:05" - the timestamp style of the PHP library rows. */
function shortWhen(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d)) return ''
  const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `${day}, ${time}`
}

/**
 * Library - pages/library.php: recently played on top, then every song you
 * have saved or played (favorites + listening history from Supabase).
 */
export default function Library() {
  const [state, setState] = useState('loading') // loading | ready | error
  const [error, setError] = useState('')
  const [tracks, setTracks] = useState([])
  const [recent, setRecent] = useState([])
  const [plays, setPlays] = useState(new Map())
  const [query, setQuery] = useState('')

  const load = useCallback(() => {
    setState('loading')
    setError('')
    fetchLibraryBundle()
      .then((bundle) => {
        setTracks(bundle.tracks)
        setRecent(bundle.recent)
        setPlays(bundle.plays)
        setState('ready')
      })
      .catch((err) => {
        setError(err?.message || 'Your library could not be loaded. Please try again.')
        setState('error')
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const refresh = () => {
      fetchLibraryBundle()
        .then((bundle) => {
          setTracks(bundle.tracks)
          setRecent(bundle.recent)
          setPlays(bundle.plays)
        })
        .catch(() => {})
    }
    window.addEventListener('melody:plays-changed', refresh)
    return () => window.removeEventListener('melody:plays-changed', refresh)
  }, [])

  const q = query.trim().toLowerCase()
  const filtered = q
    ? tracks.filter(
        (t) =>
          (t.title || '').toLowerCase().includes(q) ||
          (t.artist || '').toLowerCase().includes(q)
      )
    : tracks

  return (
    <section className="page">
      <h1 className="page-title">
        <Icon name="library" size={24} /> <span>Music Library</span>
      </h1>

      {/* Filters the list on this page as you type. The app's one search field
          lives on the Explore Music page, so this is a plain filter: no search
          landmark, no submit button (its button never did anything but swallow
          the form). */}
      <div className="search-form search-form-library">
        <span className="search-icon" aria-hidden="true">
          <Icon name="search" size={18} />
        </span>
        <label className="visually-hidden" htmlFor="librarySearch">
          Filter your library
        </label>
        <input
          type="text"
          id="librarySearch"
          name="q"
          className="search-input"
          placeholder="Filter your library..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
      </div>

      {state === 'loading' && <LoadingState label="Loading your library…" />}
      {state === 'error' && <ErrorState message={error} onRetry={load} />}

      {state === 'ready' && (
        <>
          {/* Last song played: first thing you see, no scrolling */}
          {q === '' && recent.length > 0 && (
            <>
              <h2 className="section-title">
                <Icon name="clock-3" size={18} /> <span>Recently Played</span>
                <Link className="section-more" to="/app/history">
                  See all
                </Link>
              </h2>
              <ul className="track-list">
                {recent.map((t, i) => (
                  <TrackRow
                    key={t.external_id}
                    track={t}
                    queue={recent}
                    index={i}
                    meta={shortWhen(t.played_at)}
                    /* phones drop the right-hand date column, so it is repeated
                       inside the artist line where it can wrap instead */
                    artistExtra={<span className="track-when"> &bull; {shortWhen(t.played_at)}</span>}
                    suffix={providerSuffix(t.external_id)}
                    className="when-row"
                  />
                ))}
              </ul>
            </>
          )}

          {q !== '' && filtered.length === 0 ? (
            <EmptyState
              icon={<Icon name="search" size={22} />}
              title="No results found"
              text={<>Nothing matched &ldquo;{query.trim()}&rdquo;. Try a different search.</>}
            />
          ) : tracks.length === 0 ? (
            <EmptyState
              icon={<Icon name="music" size={22} />}
              title="No songs yet"
              text="Your music collection will appear here when songs are added."
            />
          ) : (
            <>
              <h2 className="section-title">
                <Icon name="list-music" size={18} /> <span>All Songs</span>
                <span className="section-sub">
                  {plural(filtered.length, 'track', 'tracks')} in your library
                </span>
              </h2>
              <ul className="track-list">
                {filtered.map((t, i) => (
                  <TrackRow
                    key={t.external_id}
                    track={t}
                    queue={filtered}
                    index={i}
                    meta={plural(plays.get(t.external_id) || 0, 'play', 'plays')}
                    suffix={providerSuffix(t.external_id)}
                  />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  )
}
