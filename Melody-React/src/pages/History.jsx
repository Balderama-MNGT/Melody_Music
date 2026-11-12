import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icons.jsx'
import TrackRow from '../components/TrackRow.jsx'
import { EmptyState, ErrorState, LoadingState } from '../components/States.jsx'
import { usePlayer } from '../context/PlayerContext.jsx'
import { distinctByTrack, fetchHistory } from '../lib/db.js'
import { formatDate, formatDateShort, formatTime, localDay, plural, timeAgo } from '../lib/format.js'

/** "Oct 24, 2026" used by the "Earlier" bucket. */
function fullDate(iso) {
  return formatDate(iso)
}

/**
 * History - pages/history.php: your listening log, newest first, split into
 * Today / Yesterday / Earlier with one entry per track (play count + when).
 */
export default function History() {
  const { playQueue } = usePlayer()
  const [state, setState] = useState('loading') // loading | ready | error
  const [error, setError] = useState('')
  const [tracks, setTracks] = useState([])

  const load = useCallback(() => {
    setState('loading')
    setError('')
    fetchHistory()
      .then((rows) => {
        setTracks(distinctByTrack(rows))
        setState('ready')
      })
      .catch((err) => {
        setError(err?.message || 'Your history could not be loaded. Please try again.')
        setState('error')
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  /* Bucket by local day, newest bucket first (rows are already sorted DESC). */
  const today = localDay(new Date().toISOString())
  const yesterday = localDay(new Date(Date.now() - 86400000).toISOString())
  const groups = []
  if (tracks.length) {
    const buckets = new Map()
    for (const row of tracks) {
      const day = localDay(row.played_at)
      const label = day === today ? 'Today' : day === yesterday ? 'Yesterday' : 'Earlier'
      if (!buckets.has(label)) {
        buckets.set(label, [])
        groups.push(label)
      }
      buckets.get(label).push(row)
    }
  }

  const playsTotal = tracks.reduce((sum, t) => sum + (t.plays || 0), 0)
  const songsTotal = tracks.length
  const last = tracks[0] || null

  return (
    <section className="page">
      <h1 className="page-title">
        <Icon name="clock-3" size={24} /> <span>Listening History</span>
      </h1>

      {state === 'loading' && <LoadingState label="Loading your history…" />}
      {state === 'error' && <ErrorState message={error} onRetry={load} />}

      {state === 'ready' &&
        (tracks.length === 0 ? (
          <EmptyState
            icon={<Icon name="clock-3" size={22} />}
            title="No history yet"
            text="Songs you play will be listed here so you can find them again."
          >
            <Link className="btn btn-primary" to="/app">
              Start listening
            </Link>
          </EmptyState>
        ) : (
          <>
            <p className="history-summary">
              {plural(playsTotal, 'play', 'plays')} &bull; {plural(songsTotal, 'song', 'songs')}
            </p>

            {/* Last played: the first thing on the page, no scrolling needed */}
            <a
              className="home-resume history-last"
              href="/app/history"
              aria-label={`Last played: play ${last.title}`}
              onClick={(e) => {
                e.preventDefault()
                playQueue(tracks, 0)
              }}
            >
              {last.cover ? (
                <img className="home-resume-cover" src={last.cover} alt="" referrerPolicy="no-referrer" />
              ) : (
                <span className="home-resume-cover placeholder-thumb" aria-hidden="true">
                  <Icon name="music" size={26} />
                </span>
              )}
              <span className="home-resume-text">
                <span className="home-resume-label">
                  Last played &bull; {timeAgo(last.played_at)}
                </span>
                <span className="home-resume-title">{last.title}</span>
                <span className="home-resume-artist">{last.artist || 'Unknown artist'}</span>
              </span>
              <span className="home-resume-play" aria-hidden="true">
                <Icon name="play" size={20} />
              </span>
            </a>

            {groups.map((label) => {
              const rows = bucketRows(tracks, label, today, yesterday)
              return (
                <div key={label}>
                  <h2 className="section-title">
                    <span>{label}</span>
                    <span className="section-sub">{plural(rows.length, 'song', 'songs')}</span>
                  </h2>
                  <ul className="track-list">
                    {rows.map((row, idx) => (
                      <TrackRow
                        key={`${label}-${row.external_id}`}
                        track={row}
                        queue={rows}
                        index={idx}
                        className="history-row"
                        meta={historyMeta(row, label)}
                        artistExtra={<span className="track-when"> &bull; {historyShort(row, label)}</span>}
                        suffix=" • Audius"
                      />
                    ))}
                  </ul>
                </div>
              )
            })}
          </>
        ))}
    </section>
  )
}

/** The rows belonging to one day bucket. */
function bucketRows(tracks, label, today, yesterday) {
  return tracks.filter((row) => {
    const day = localDay(row.played_at)
    if (label === 'Today') return day === today
    if (label === 'Yesterday') return day === yesterday
    return day !== today && day !== yesterday
  })
}

/** "3 plays • Oct 24, 2026 • 14:05" (right-hand column of a history row). */
function historyMeta(row, label) {
  const when = label === 'Earlier' ? `${fullDate(row.played_at)} • ${formatTime(row.played_at)}` : formatTime(row.played_at)
  return `${row.plays || 0} ${row.plays === 1 ? 'play' : 'plays'} • ${when}`
}

/** " • 14:05" / " • Oct 24" - shown inside the artist line on phones. */
function historyShort(row, label) {
  return label === 'Earlier' ? formatDateShort(row.played_at) : formatTime(row.played_at)
}
