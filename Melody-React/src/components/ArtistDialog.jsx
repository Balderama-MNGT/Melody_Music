import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icons.jsx'
import { audiusRequest } from '../lib/api.js'
import { fmtCount } from '../lib/format.js'
import TrackRow from './TrackRow.jsx'
import { EmptyState, ErrorState, LoadingState } from './States.jsx'

/** Artist photo with the same placeholder fallback as the PHP version. */
export function Avatar({ url, className }) {
  const [failed, setFailed] = useState(false)
  if (!url || failed) {
    return (
      <span className={`${className} artist-avatar-ph`} aria-hidden="true">
        <Icon name="users" size={30} />
      </span>
    )
  }
  return (
    <img
      className={className}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      src={url}
      onError={() => setFailed(true)}
    />
  )
}

/**
 * Artist panel - openArtist() from assets/js/audius.js.
 * Loads one artist's real Audius catalog and plays it through the bottom player.
 */
export default function ArtistDialog({ artist, onClose }) {
  const [state, setState] = useState('loading') // loading | ready | error | empty
  const [tracks, setTracks] = useState([])
  const [error, setError] = useState('')
  const [debug, setDebug] = useState(null)
  const closeRef = useRef(null)

  const load = useCallback(() => {
    setState('loading')
    audiusRequest({ action: 'artist_tracks', id: artist.id, limit: 30 })
      .then((res) => {
        const list = (res.tracks || []).filter((t) => t.streamable)
        if (!list.length) {
          setTracks([])
          setState('empty')
          return
        }
        setTracks(list)
        setState('ready')
      })
      .catch((err) => {
        setError(err?.message || 'Could not load this artist’s tracks.')
        setDebug(err?.debug ?? null)
        setState('error')
      })
  }, [artist.id])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const bits = []
  if (artist.handle) bits.push(`@${artist.handle}`)
  if (artist.follower_count) bits.push(`${fmtCount(artist.follower_count)} followers`)
  if (artist.track_count !== null && artist.track_count !== undefined) {
    bits.push(`${artist.track_count} ${artist.track_count === 1 ? 'track' : 'tracks'}`)
  }

  return createPortal(
    <div
      className="artist-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="artist-box" role="dialog" aria-modal="true" aria-labelledby="artistTitle">
        <div className="artist-head">
          <Avatar url={artist.avatar} className="artist-head-avatar" />
          <div className="artist-head-meta">
            <h2 id="artistTitle">{artist.name}</h2>
            {bits.length > 0 && <p className="artist-head-sub">{bits.join(' \u2022 ')}</p>}
          </div>
          <button
            ref={closeRef}
            type="button"
            className="btn-icon artist-close"
            aria-label="Close"
            title="Close"
            onClick={onClose}
          >
            <Icon name="x" size={20} />
          </button>
        </div>

        <div className="artist-tracks">
          {state === 'loading' && <LoadingState label={`Loading tracks by ${artist.name}…`} />}
          {state === 'error' && <ErrorState message={error} onRetry={load} debug={debug} />}
          {state === 'empty' && (
            <EmptyState
              title="No tracks available"
              text="This artist has no streamable tracks on Audius right now."
            />
          )}
          {state === 'ready' && (
            <ul className="track-list">
              {tracks.map((t, i) => (
                <TrackRow key={t.external_id} track={t} queue={tracks} index={i} suffix=" • Audius" />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
