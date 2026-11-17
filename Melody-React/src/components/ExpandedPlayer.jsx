import { useEffect } from 'react'
import { Icon, BrandMark } from './Icons.jsx'
import CoverArt from './CoverArt.jsx'
import FavButton from './FavButton.jsx'
import { AddToPlaylistButton } from './PlaylistPicker.jsx'
import Recommendations from './Recommendations.jsx'
import PlaylistSongs from './PlaylistSongs.jsx'
import { usePlayer } from '../context/PlayerContext.jsx'
import { fmtDuration } from '../lib/format.js'

/**
 * Full-screen "Now Playing" view. The .np-video-slot is EMPTY on purpose:
 * PlayerContext moves the SAME dashboard iframe into it (geometry only), so
 * there is one player, one visible video, and no playback restart on switch.
 * Every control reads/writes the same PlayerContext state as the mini bar.
 */
const REPEAT_LABELS = { off: 'Off', all: 'All', one: 'One' }

export default function ExpandedPlayer() {
  const {
    current,
    playing,
    loading,
    time,
    duration,
    repeat,
    shuffle,
    playbackMode,
    hasTrack,
    toggle,
    next,
    prev,
    seekPercent,
    cycleRepeat,
    toggleShuffle,
    closePlayer,
  } = usePlayer()

  useEffect(() => {
    /* Open at the top of the expanded view (the document scrolls now). */
    window.scrollTo(0, 0)
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (document.querySelector('.pl-overlay')) return // the picker owns Escape
      closePlayer()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [closePlayer])

  const percent = duration > 0 ? Math.min(100, (time / duration) * 100) : 0
  const title = current ? current.title : 'No song selected'
  const artist = current ? current.artist || 'Unknown artist' : 'Choose a track to start listening'

  return (
    <div className="np-screen" role="dialog" aria-modal="true" aria-label="Now playing">
      <header className="np-header">
        <div className="np-brand">
          <BrandMark size={22} />
          <span className="np-brand-name">Melody</span>
          <span className="np-divider" aria-hidden="true" />
          <span className="np-eyebrow">Now playing</span>
        </div>
        <button
          type="button"
          className="btn-icon np-close"
          aria-label="Minimize now playing"
          title="Back to mini player"
          onClick={closePlayer}
        >
          <Icon name="chevron-down" size={22} />
        </button>
      </header>

      <div className="np-body">
        {/* EMPTY on purpose: the one dashboard iframe is moved over this slot
            by PlayerContext, so there is never a second player instance. */}
        <div className="np-video-slot" aria-hidden="true" />

        <div className="np-main">
          <section className="np-details">
            {/* Compact artwork beside the title - the video above already
                supplies the large visual, so there is no duplicate cover. */}
            <div className="np-track-head">
              <div className="np-cover">
                {current ? (
                  <CoverArt
                    track={current}
                    placeholderClassName="np-cover-placeholder"
                    placeholderSize={26}
                  />
                ) : (
                  <span className="np-cover-placeholder" aria-hidden="true">
                    <Icon name="music" size={26} />
                  </span>
                )}
              </div>
              <div className="np-meta">
                <span className="np-eyebrow np-status">
                  {loading ? 'Loading…' : 'Now playing'}
                </span>
                <h2 className="np-title" title={title}>{title}</h2>
                <p className="np-artist" title={artist}>{artist}</p>
              </div>
            </div>

            <div className="np-actions">
              <FavButton track={current} className="btn btn-icon btn-fav np-action" />
              <AddToPlaylistButton track={current} className="btn btn-icon btn-addpl np-action" />
            </div>

            <div className="np-progress">
              <input
                className="np-seek"
                type="range"
                min="0"
                max="100"
                step="0.1"
                value={percent}
                aria-label="Seek"
                disabled={!hasTrack || duration <= 0}
                onChange={(e) => seekPercent(Number(e.target.value))}
              />
              <div className="np-times">
                <span className="np-time">{fmtDuration(time)}</span>
                <span className="np-time">{fmtDuration(duration)}</span>
              </div>
            </div>

            <div className="np-controls">
              <button
                type="button"
                className="btn-icon np-btn"
                aria-label="Previous track"
                title="Previous"
                disabled={!hasTrack}
                onClick={prev}
              >
                <Icon name="skip-back" size={24} />
              </button>
              <button
                type="button"
                className={`np-play${playing ? ' is-playing' : ''}`}
                aria-label={hasTrack ? (playing ? 'Pause' : 'Play') : 'Play (no song selected)'}
                title={playing ? 'Pause' : 'Play'}
                aria-pressed={playing}
                disabled={!hasTrack}
                onClick={toggle}
              >
                <span className="icon-state icon-state-play" aria-hidden="true">
                  <Icon name="play" size={26} />
                </span>
                <span className="icon-state icon-state-pause" aria-hidden="true">
                  <Icon name="pause" size={26} />
                </span>
              </button>
              <button
                type="button"
                className="btn-icon np-btn"
                aria-label="Next track"
                title="Next"
                disabled={!hasTrack}
                onClick={next}
              >
                <Icon name="skip-forward" size={24} />
              </button>
              <button
                type="button"
                className={`btn-icon np-btn np-shuffle${shuffle ? ' is-active' : ''}`}
                aria-label={`Shuffle: ${shuffle ? 'On' : 'Off'}`}
                title={`Shuffle: ${shuffle ? 'On' : 'Off'}`}
                aria-pressed={shuffle}
                data-shuffle={shuffle ? 'on' : 'off'}
                onClick={toggleShuffle}
              >
                <Icon name="shuffle" size={22} />
              </button>
              <button
                type="button"
                className={`btn-icon np-btn np-repeat${repeat !== 'off' ? ' is-active' : ''}`}
                aria-label={`Repeat: ${REPEAT_LABELS[repeat] || REPEAT_LABELS.off}`}
                title={`Repeat: ${REPEAT_LABELS[repeat] || REPEAT_LABELS.off}`}
                data-repeat={repeat}
                onClick={cycleRepeat}
              >
                <Icon name={repeat === 'one' ? 'repeat-1' : 'repeat'} size={22} />
              </button>
            </div>

            <button type="button" className="btn btn-outline np-minimize-bottom" onClick={closePlayer}>
              <Icon name="chevron-down" size={18} />
              <span>Minimize player</span>
            </button>
          </section>
        </div>

        {/* One section, chosen by playback context - never both at once. */}
        {playbackMode === 'playlist' ? <PlaylistSongs /> : <Recommendations track={current} />}
      </div>
    </div>
  )
}
