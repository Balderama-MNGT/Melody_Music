import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icons.jsx'
import MusicSection from '../components/MusicSection.jsx'
import CoverArt from '../components/CoverArt.jsx'
import TrackRow from '../components/TrackRow.jsx'
import { EmptyState, ErrorState, LoadingState } from '../components/States.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { usePlayer } from '../context/PlayerContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import {
  distinctByTrack,
  fetchFavoriteTracks,
  fetchHistory,
  fetchPlaylists,
  fetchPlaylistTracks,
  fetchStats,
} from '../lib/db.js'
import { providerSuffix } from '../lib/api.js'
import { greeting, plural } from '../lib/format.js'
import { playSection } from '../lib/sections.js'

/**
 * Home - pages/home.php: hero with your numbers, quick access, the YouTube
 * Trending / Discover / Artists rows, your playlists, favorites and top played.
 */
export default function Home() {
  const { session, profile } = useAuth()
  const { playQueue, current, playing, loading, toggle } = usePlayer()
  const toast = useToast()

  const [state, setState] = useState('loading') // loading | ready | error
  const [error, setError] = useState('')
  const [stats, setStats] = useState({ favs: 0, lists: 0, plays: 0 })
  const [playlists, setPlaylists] = useState([])
  const [favorites, setFavorites] = useState([])
  const [recent, setRecent] = useState([])
  const [top, setTop] = useState([])

  const load = useCallback(() => {
    setState('loading')
    setError('')
    Promise.all([fetchStats(), fetchPlaylists(), fetchFavoriteTracks(), fetchHistory()])
      .then(([st, pls, favs, hist]) => {
        const distinct = distinctByTrack(hist)
        setStats(st)
        setPlaylists(pls.slice(0, 12))
        setFavorites(favs.slice(0, 8))
        setRecent(distinct.slice(0, 8))
        setTop(
          distinct
            .filter((t) => t.plays > 0)
            .sort((a, b) => b.plays - a.plays)
            .slice(0, 5)
        )
        setState('ready')
      })
      .catch((err) => {
        setError(err?.message || 'Your music could not be loaded. Please try again.')
        setState('error')
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  /* A confirmed play insert refreshes the counter from the database. */
  useEffect(() => {
    const refresh = () => {
      Promise.all([fetchStats(), fetchHistory()])
        .then(([st, hist]) => {
          const distinct = distinctByTrack(hist)
          setStats(st)
          setRecent(distinct.slice(0, 8))
          setTop(distinct.filter((t) => t.plays > 0).sort((a, b) => b.plays - a.plays).slice(0, 5))
        })
        .catch(() => {})
    }
    window.addEventListener('melody:plays-changed', refresh)
    return () => window.removeEventListener('melody:plays-changed', refresh)
  }, [])

  const name = profile?.username || session?.user?.user_metadata?.username || 'there'

  /* "Jump back in" mirrors the real player: whatever the shared <audio> element
     is loaded wins, so the card always shows the live track (and its state).
     With nothing playing it falls back to the newest entry of your history. */
  const live = Boolean(current)
  const resume = current || recent[0] || null
  const resumeLabel = live
    ? loading
      ? 'Loading…'
      : playing
        ? 'Now playing'
        : 'Paused'
    : 'Jump back in'

  /** Play every track of one playlist (used by the quick-access tiles). */
  async function playPlaylist(playlist) {
    try {
      const tracks = await fetchPlaylistTracks(playlist.id)
      if (!tracks.length) {
        toast(`“${playlist.name}” has no tracks yet.`, true)
        return
      }
      playQueue(tracks, 0, { type: 'playlist', id: playlist.id, name: playlist.name })
    } catch (err) {
      toast(err?.message || 'Could not open that playlist.', true)
    }
  }

  const quick = [
    {
      href: '/app/favorites',
      title: 'Liked Songs',
      kind: 'liked',
      sub: plural(stats.favs, 'song', 'songs'),
      cover: '',
      play: favorites.length ? () => playQueue(favorites, 0) : null,
    },
    {
      href: '/app/history',
      title: 'Recently Played',
      kind: 'recent',
      sub: plural(stats.plays, 'play', 'plays'),
      cover: '',
      play: recent.length ? () => playQueue(recent, 0) : null,
    },
    ...playlists.slice(0, 4).map((pl) => ({
      href: `/app/playlists/${pl.id}`,
      title: pl.name,
      kind: 'playlist',
      sub: plural(pl.track_count, 'song', 'songs'),
      cover: pl.cover,
      play: () => playPlaylist(pl),
    })),
  ]

  return (
    <section className="page home">
      {/* Hero: greeting, your numbers, quick actions */}
      <header className="home-hero">
        <div className="home-hero-main">
          <p className="home-eyebrow">Your music, all in one place</p>
          <h1 className="page-title home-title">
            <span>{greeting()}</span>, {name}{' '}
            <span className="wave" aria-hidden="true">
              &#128075;
            </span>
          </h1>
          <p className="home-stats">
            <span>{plural(stats.favs, 'favorite', 'favorites')}</span>
            <span aria-hidden="true">&bull;</span>
            <span>{plural(stats.lists, 'playlist', 'playlists')}</span>
            <span aria-hidden="true">&bull;</span>
            <span>{plural(stats.plays, 'play', 'plays')}</span>
          </p>
          <div className="home-actions">
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={() => playSection('trending', toast)}
            >
              <Icon name="play" size={18} /> <span>Play trending</span>
            </button>
            <a className="btn btn-outline btn-lg" href="#home-artists">
              <Icon name="users" size={18} /> <span>Browse artists</span>
            </a>
          </div>
        </div>

        {resume && (
          <a
            className={`home-resume${live ? ' is-live' : ''}${live && playing ? ' is-playing' : ''}${
              live && loading ? ' is-loading' : ''
            }`}
            href="/app/history"
            aria-label={
              live
                ? `${playing ? 'Pause' : 'Play'} ${resume.title}${resume.artist ? ` by ${resume.artist}` : ''}`
                : `Jump back in: play ${resume.title}`
            }
            onClick={(e) => {
              e.preventDefault()
              if (live) toggle()      // a track is loaded: drive the real player
              else playQueue(recent, 0) // nothing loaded yet: restart the history queue
            }}
          >
            <span className="home-resume-cover">
              <CoverArt
                track={resume}
                className="home-resume-img"
                placeholderClassName="home-resume-img placeholder-thumb"
                placeholderSize={24}
              />
              {live && playing && (
                <span className="home-resume-badge" aria-hidden="true">
                  <span className="home-resume-eq">
                    <i />
                    <i />
                    <i />
                  </span>
                </span>
              )}
              {live && loading && (
                <span className="home-resume-badge" aria-hidden="true">
                  <span className="spinner home-resume-spinner" />
                </span>
              )}
            </span>
            <span className="home-resume-text">
              <span className="home-resume-label">{resumeLabel}</span>
              <span className="home-resume-title">{resume.title}</span>
              <span className="home-resume-artist">{resume.artist || 'Unknown artist'}</span>
            </span>
            <span className="home-resume-play" aria-hidden="true">
              <Icon name={playing ? 'pause' : 'play'} size={20} />
            </span>
          </a>
        )}
      </header>

      {state === 'loading' && <LoadingState label="Loading your music…" />}
      {state === 'error' && <ErrorState message={error} onRetry={load} />}

      {state === 'ready' && (
        <>
          {/* Quick access */}
          <nav className="quick-grid" aria-label="Quick access">
            {quick.map((q) => (
              <div className={`quick-tile quick-${q.kind}`} key={q.href + q.title}>
                <Link className="quick-link" to={q.href}>
                  {q.cover ? (
                    <img className="quick-thumb" src={q.cover} alt="" loading="lazy" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="quick-thumb quick-thumb-icon" aria-hidden="true">
                      <Icon name={q.kind === 'liked' ? 'heart' : q.kind === 'recent' ? 'clock-3' : 'list-music'} size={24} />
                    </span>
                  )}
                  <span className="quick-text">
                    <span className="quick-title">{q.title}</span>
                    <span className="quick-sub">{q.sub}</span>
                  </span>
                </Link>
                {q.play && (
                  <a
                    className="quick-play"
                    href={q.href}
                    aria-label={`Play ${q.title}`}
                    onClick={(e) => {
                      e.preventDefault()
                      q.play()
                    }}
                  >
                    <Icon name="play" size={18} />
                  </a>
                )}
              </div>
            ))}
          </nav>

          {/* Trending Music (YouTube) */}
          <h2 className="section-title">
            <Icon name="trending-up" size={18} /> <span>Trending Music</span>
            <button type="button" className="section-more section-btn" onClick={() => playSection('trending', toast)}>
              Play all
            </button>
          </h2>
          <div className="music-section">
            <MusicSection mode="trending" limit={10} layout="row" />
          </div>

          {/* Discover Music (YouTube) */}
          <h2 className="section-title">
            <Icon name="disc-3" size={18} /> <span>Discover Music</span>
            <span className="section-sub">Fresh picks from across YouTube</span>
            <button type="button" className="section-more section-btn" onClick={() => playSection('discover', toast)}>
              Play all
            </button>
          </h2>
          <div className="music-section">
            <MusicSection mode="discover" limit={10} layout="row" />
          </div>

          {/* Artists (YouTube) */}
          <h2 className="section-title" id="home-artists">
            <Icon name="users" size={18} /> <span>Artists</span>
            <span className="section-sub">Open an artist to hear their tracks</span>
          </h2>
          <div className="music-section">
            <MusicSection mode="artists" limit={12} layout="row" />
          </div>

          {/* Your Playlists + Favorites, side by side */}
          <div className="two-col home-cols">
            <div>
              <h2 className="section-title">
                <Icon name="list-music" size={18} /> <span>Your Playlists</span>
                {playlists.length > 0 && (
                  <Link className="section-more" to="/app/playlists">
                    See all
                  </Link>
                )}
              </h2>
              {playlists.length === 0 ? (
                <EmptyState
                  icon={<Icon name="list-music" size={22} />}
                  title="No playlists yet"
                  text={
                    <>
                      Create a playlist to organize your music, or use the{' '}
                      <strong>add to playlist</strong> button on any song.
                    </>
                  }
                >
                  <Link className="btn btn-primary" to="/app/playlists">
                    Create a playlist
                  </Link>
                </EmptyState>
              ) : (
                <div className="card-grid">
                  {playlists.map((pl) => (
                    <Link className="list-card" to={`/app/playlists/${pl.id}`} key={pl.id}>
                      {pl.cover ? (
                        <img className="list-card-thumb" src={pl.cover} alt="" referrerPolicy="no-referrer" />
                      ) : (
                        <span className="list-card-thumb" aria-hidden="true">
                          <Icon name="list-music" size={22} />
                        </span>
                      )}
                      <div className="list-card-body">
                        <div className="list-card-title">{pl.name}</div>
                        <div className="list-card-sub">
                          {plural(pl.track_count, 'song', 'songs')} &bull; Created {formatCreated(pl.created_at)}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h2 className="section-title">
                <Icon name="heart" size={18} /> <span>Favorites</span>
                {favorites.length > 0 && (
                  <Link className="section-more" to="/app/favorites">
                    See all
                  </Link>
                )}
              </h2>
              {favorites.length === 0 ? (
                <EmptyState
                  icon={<Icon name="heart" size={22} />}
                  title="No favorites yet"
                  text="Tap the heart on any song to save it here."
                />
              ) : (
                <ul className="track-list">
                  {favorites.map((t, i) => (
                    <TrackRow key={t.external_id} track={t} queue={favorites} index={i} suffix={providerSuffix(t.external_id)} />
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Top played */}
          <h2 className="section-title">
            <Icon name="trending-up" size={18} /> <span>Top Played</span>
          </h2>
          {top.length === 0 ? (
            <EmptyState
              icon={<Icon name="play" size={22} />}
              title="Nothing played yet"
              text="Songs you play will be ranked here once people start listening."
            />
          ) : (
            <ol className="track-list">
              {top.map((t, i) => (
                <TrackRow
                  key={t.external_id}
                  track={t}
                  queue={top}
                  index={i}
                  meta={`${t.plays} ${t.plays === 1 ? 'play' : 'plays'}`}
                  suffix={providerSuffix(t.external_id)}
                />
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  )
}

/** "Oct 24, 2026" for a playlist's creation date. */
function formatCreated(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d)) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
