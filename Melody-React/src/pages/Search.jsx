import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Icon } from '../components/Icons.jsx'
import MusicSection from '../components/MusicSection.jsx'
import SearchBox from '../components/SearchBox.jsx'
import TrackRow from '../components/TrackRow.jsx'
import { EmptyState } from '../components/States.jsx'
import { fetchLibraryTracks } from '../lib/db.js'

/**
 * Search - pages/search.php: the app's one search field sits directly under
 * the page title, the suggestions hang off it, YouTube results follow, then
 * your own library.
 *
 * The box owns the query: typing only feeds the suggestions, Enter or the
 * Search button pushes ?q= (and Back/forward writes it back into the box),
 * so the results and the field can never disagree. Nothing else in the app
 * holds a search input - the sidebar and the topbar stay input-free.
 */
export default function Search() {
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const q = (params.get('q') || '').trim()

  /* What the box shows: the submitted query, plus anything typed since. */
  const [term, setTerm] = useState(q)
  useEffect(() => {
    setTerm(q)
  }, [q])

  /* The header search bar routes here with focusSearch in the location state.
     Focusing the page's own input keeps one search implementation and one
     source of truth (the ?q= URL) - the header never searches by itself. */
  const shouldFocus = Boolean(location.state && location.state.focusSearch)
  useEffect(() => {
    if (!shouldFocus) return undefined
    const frame = requestAnimationFrame(() => document.getElementById('pageSearch')?.focus())
    return () => cancelAnimationFrame(frame)
  }, [shouldFocus, q])

  const [library, setLibrary] = useState(null) // null = not loaded yet

  /* YouTube answers for this page through MusicSection, which reports the
     state it is in together with the query it belongs to - so a new ?q= is
     never read as the previous query's outcome. */
  const [sectionReport, setSectionReport] = useState({ q: null, state: 'loading' })
  const reportSection = useCallback((rq, state) => {
    setSectionReport((prev) => (prev.q === rq && prev.state === state ? prev : { q: rq, state }))
  }, [])
  const sectionState = sectionReport.q === q ? sectionReport.state : 'loading'

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

  /* YouTube came back empty and the library has nothing either: one clear
     message instead of two stacked "nothing here" boxes. */
  const noResults =
    q !== '' && sectionState === 'empty' && library !== null && hits.length === 0

  function submit(value) {
    const next = String(value || '').trim()
    const target = next ? `/app/search?q=${encodeURIComponent(next)}` : '/app/search'
    /* The same query is already on screen: Enter twice in a row must not push
       a duplicate history entry (Back would then retrace the same page). */
    if (`${location.pathname}${location.search}` === target) return
    navigate(target)
  }

  return (
    <section className="page">
      <header className="page-header">
        <h1 className="page-title">
          <Icon name="search" size={24} />
          <span>Explore Music</span>
        </h1>
        {q !== '' && (
          <p className="page-subtitle">
            Showing results for <strong>&ldquo;{q}&rdquo;</strong>
          </p>
        )}
      </header>

      {/* The app's only search field: suggestions drop straight under it and
          hide the moment the query is submitted. */}
      <SearchBox
        value={term}
        onChange={setTerm}
        onSubmit={submit}
        inputId="pageSearch"
        formClassName="search-form-page"
      />

      {q === '' ? (
        <EmptyState
          icon={<Icon name="search" size={22} />}
          title="Start searching"
          text="Type a song, artist, album or keyword in the search bar above to search YouTube and your own library."
        />
      ) : noResults ? (
        <EmptyState
          icon={<Icon name="search" size={22} />}
          title={`No matches for \u201C${q}\u201D`}
          text="Try different keywords, or check the spelling."
        />
      ) : (
        <>
          <h2 className="section-title">
            <Icon name="music" size={18} /> <span>On YouTube</span>
          </h2>
          <div className="music-section">
            <MusicSection mode="search" query={q} limit={20} onStatus={reportSection} />
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
