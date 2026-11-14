import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Icon } from '../components/Icons.jsx'
import AudiusSection from '../components/AudiusSection.jsx'
import TrackRow from '../components/TrackRow.jsx'
import { EmptyState } from '../components/States.jsx'
import { fetchLibraryTracks } from '../lib/db.js'

/**
 * Search - pages/search.php: Audius results on top, your own library below.
 *
 * The app has exactly one search field - the one in the topbar - so this page
 * only renders a header plus the results for its ?q=. Two boxes with their own
 * autocomplete used to fight each other over the same query.
 */
export default function Search() {
  const [params] = useSearchParams()
  const q = (params.get('q') || '').trim()

  const [library, setLibrary] = useState(null) // null = not loaded yet

  useEffect(() => {
    let alive = true
    fetchLibraryTracks()
      .then((rows) => alive && setLibrary(rows))
      .catch(() => alive && setLibrary([]))
    return () => {
      alive = false
    }
  }, [])

  const hits = q
    ? (library || []).filter((t) => {
        const needle = q.toLowerCase()
        return (
          (t.title || '').toLowerCase().includes(needle) ||
          (t.artist || '').toLowerCase().includes(needle)
        )
      })
    : []

  return (
    <section className="page">
      <header className="page-header">
        <h1 className="page-title">
          <Icon name="search" size={24} />
          <span>{q === '' ? 'Explore Music' : 'Search Results'}</span>
        </h1>
        {q !== '' && (
          <p className="page-subtitle">
            Showing results for <strong>&ldquo;{q}&rdquo;</strong>
          </p>
        )}
      </header>

      {q === '' ? (
        <EmptyState
          icon={<Icon name="search" size={22} />}
          title="Start searching"
          text="Type a song, artist, album or keyword in the search bar at the top of the page to search Audius and your own library."
        />
      ) : (
        <>
          <h2 className="section-title">
            <Icon name="music" size={18} /> <span>On Audius</span>
          </h2>
          <div className="audius-section">
            <AudiusSection mode="search" query={q} limit={20} />
          </div>

          <h2 className="section-title">
            <Icon name="library" size={18} /> <span>In your library</span>
          </h2>
          {library === null ? (
            <p className="results-count">Loading your library…</p>
          ) : hits.length === 0 ? (
            <EmptyState
              icon={<Icon name="search" size={22} />}
              title="Nothing in your library"
              text={<>No songs in your library matched &ldquo;{q}&rdquo;.</>}
            />
          ) : (
            <>
              <p className="results-count">{hits.length} result(s)</p>
              <ul className="track-list">
                {hits.map((t, i) => (
                  <TrackRow key={t.external_id} track={t} queue={hits} index={i} />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  )
}
