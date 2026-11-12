import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Icon } from '../components/Icons.jsx'
import SearchBox from '../components/SearchBox.jsx'
import AudiusSection from '../components/AudiusSection.jsx'
import TrackRow from '../components/TrackRow.jsx'
import { EmptyState } from '../components/States.jsx'
import { fetchLibraryTracks } from '../lib/db.js'

/** Search - pages/search.php: Audius results on top, your own library below. */
export default function Search() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const q = (params.get('q') || '').trim()

  const [input, setInput] = useState(q)
  const [library, setLibrary] = useState(null) // null = not loaded yet

  /* Keep the box in step with the URL (topbar search writes ?q= too). */
  useEffect(() => {
    setInput(q)
  }, [q])

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
      <h1 className="page-title">
        <Icon name="search" size={24} /> <span>Search</span>
      </h1>

      <SearchBox
        value={input}
        onChange={setInput}
        onSubmit={(text) => navigate(text ? `/app/search?q=${encodeURIComponent(text)}` : '/app/search')}
        inputId="pageSearch"
        autoFocus
        formClassName="search-form-page"
      />

      {q === '' ? (
        <EmptyState
          icon={<Icon name="search" size={22} />}
          title="Start searching"
          text="Type a song, artist, album or keyword above to search Audius and your own library."
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
