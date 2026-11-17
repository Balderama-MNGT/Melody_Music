import { useCallback, useEffect, useState } from 'react'
import { youtubeRequest } from '../lib/api.js'
import { usePlayer } from '../context/PlayerContext.jsx'
import { publishSection, unpublishSection } from '../lib/sections.js'
import TrackCard from './TrackCard.jsx'
import TrackRow from './TrackRow.jsx'
import ScrollRow from './ScrollRow.jsx'
import ArtistDialog, { Avatar } from './ArtistDialog.jsx'
import { EmptyState, ErrorState, LoadingState, SkeletonRow } from './States.jsx'

/**
 * One music section (trending / discover / search / artists) backed by the
 * YouTube Data API - the React version of initTracks() + initArtists().
 *
 * mode    - trending | discover | search | artists
 * query   - search text (search mode only)
 * limit   - how many items to ask for
 * layout  - "row" = horizontally scrolling strip on the home page,
 *           otherwise a grid (search always renders rows, like the PHP page).
 * onStatus- optional (query, state) callback, so a page hosting a search can
 *           tell when nothing matched at all. State only - the request itself
 *           stays here, and the callback must be stable (useCallback) because
 *           it is part of what re-triggers the load.
 */
const LABELS = {
  trending: 'Loading trending tracks…',
  discover: 'Digging up fresh picks…',
  search: 'Searching YouTube…',
  artists: 'Finding artists on YouTube…',
}

function toQueueItem(t) {
  return {
    external_id: t.external_id,
    title: t.title,
    artist: t.artist,
    cover: t.cover,
    mirrors: t.mirrors || [],
    genre: t.genre,
    duration: t.duration,
  }
}

export default function MusicSection({ mode, query = '', limit, layout = 'grid', onStatus }) {
  const { playQueue } = usePlayer()
  const [state, setState] = useState('loading') // loading | ready | error | empty | idle
  const [tracks, setTracks] = useState([])
  const [artists, setArtists] = useState([])
  const [error, setError] = useState('')
  const [debug, setDebug] = useState(null)
  const [artist, setArtist] = useState(null)

  const isArtists = mode === 'artists'
  const isSearch = mode === 'search'
  const effectiveLimit = Number(limit) || (isSearch ? 20 : 18)
  const canPlayAll = mode === 'trending' || mode === 'discover'

  const play = useCallback((list, i) => playQueue(list.map(toQueueItem), i), [playQueue])

  /* Every transition goes through here: one setState, one report, so a page
     listening via onStatus can never see a state this component is not in.
     (Reporting from a separate effect would hand a fresh query the previous
     query's answer for a frame.) */
  const applyState = useCallback(
    (next) => {
      setState(next)
      onStatus?.(query, next)
    },
    [onStatus, query]
  )

  const load = useCallback(() => {
    if (isSearch && query.trim() === '') {
      applyState('idle')
      return
    }
    applyState('loading')

    const params = isArtists
      ? { action: 'artists', limit: String(effectiveLimit) }
      : isSearch
        ? { action: 'search', q: query.trim(), limit: String(effectiveLimit) }
        : { action: mode, limit: String(effectiveLimit) }

    youtubeRequest(params)
      .then((res) => {
        if (isArtists) {
          const list = res.artists || []
          if (!list.length) {
            applyState('empty')
            return
          }
          setArtists(list)
          applyState('ready')
          return
        }
        const list = (res.tracks || []).filter((t) => t.streamable)
        if (!list.length) {
          setTracks([])
          applyState('empty')
          return
        }
        setTracks(list)
        applyState('ready')
      })
      .catch((err) => {
        setError(err?.message || 'Melody could not load YouTube tracks.')
        setDebug(err?.debug ?? null)
        applyState('error')
      })
  }, [mode, query, effectiveLimit, isArtists, isSearch, applyState])

  useEffect(() => {
    load()
  }, [load])

  /* Publish the row so the "Play all" buttons can start its queue. */
  useEffect(() => {
    if (!canPlayAll) return undefined
    publishSection(mode, { state, tracks, play: () => play(tracks, 0) })
    return () => unpublishSection(mode)
  }, [canPlayAll, mode, state, tracks, play])

  if (state === 'idle') return null

  if (state === 'loading') {
    return layout === 'row' ? (
      <SkeletonRow artists={isArtists} label={LABELS[mode] || LABELS.trending} />
    ) : (
      <LoadingState label={LABELS[mode] || LABELS.trending} />
    )
  }

  if (state === 'error') {
    return <ErrorState message={error} onRetry={load} debug={debug} />
  }

  if (state === 'empty') {
    if (isSearch) {
      return (
        <EmptyState
          title="No YouTube results"
          text={`Nothing on YouTube matched \u201C${query}\u201D. Try different keywords.`}
        />
      )
    }
    if (isArtists) {
      return (
        <EmptyState
          title="No artists to show right now"
          text="YouTube did not return any artists. Please check back in a moment."
        />
      )
    }
    return (
      <EmptyState
        title={mode === 'discover' ? 'Nothing new to discover right now' : 'No trending tracks right now'}
        text="YouTube did not return any tracks. Please check back in a moment."
      />
    )
  }

  /* ---- ready ---- */

  if (isArtists) {
    const cards = artists.map((a) => (
      <button
        key={a.id}
        type="button"
        className="artist-card"
        aria-label={`View tracks by ${a.name}`}
        onClick={() => setArtist(a)}
      >
        <Avatar url={a.avatar} className="artist-avatar" />
        <div className="artist-card-name">{a.name}</div>
        <ArtistSub artist={a} />
      </button>
    ))

    return (
      <>
        {layout === 'row' ? (
          <ScrollRow gridClassName="artist-grid">{cards}</ScrollRow>
        ) : (
          <div className="artist-grid">{cards}</div>
        )}
        {artist && <ArtistDialog artist={artist} onClose={() => setArtist(null)} />}
      </>
    )
  }

  if (isSearch) {
    return (
      <ul className="track-list">
        {tracks.map((t, i) => (
          <TrackRow key={t.external_id} track={t} queue={tracks} index={i} />
        ))}
      </ul>
    )
  }

  const cards = tracks.map((t, i) => (
    <TrackCard key={t.external_id} track={t} queue={tracks} index={i} />
  ))

  if (layout === 'row') {
    return <ScrollRow gridClassName="song-grid">{cards}</ScrollRow>
  }
  return <div className="song-grid">{cards}</div>
}

/** "@handle • 12 tracks" under an artist card (same bits as the PHP version). */
function ArtistSub({ artist }) {
  const bits = []
  if (artist.handle) bits.push(`@${artist.handle}`)
  if (artist.track_count !== null && artist.track_count !== undefined) {
    bits.push(`${artist.track_count} ${artist.track_count === 1 ? 'track' : 'tracks'}`)
  }
  if (!bits.length) return null
  return <div className="artist-card-sub">{bits.join(' \u2022 ')}</div>
}
