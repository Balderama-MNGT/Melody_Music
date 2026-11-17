import { Icon } from './Icons.jsx'
import CoverArt from './CoverArt.jsx'
import FavButton from './FavButton.jsx'
import { AddToPlaylistButton } from './PlaylistPicker.jsx'
import { usePlayer } from '../context/PlayerContext.jsx'
import { fmtDuration } from '../lib/format.js'

/**
 * Compact bottom bar. Every value comes from PlayerContext, which owns the
 * single YouTube player.
 *   LEFT   - artwork + song title/artist
 *   CENTER - Previous / Play-Pause / Next, with the seek bar underneath
 *   RIGHT  - favorite, add-to-playlist, repeat and expand
 * There is no in-app volume control; listeners use their device volume.
 */
const REPEAT_LABELS = { off: 'Off', all: 'All', one: 'One' }

export default function Player() {
  const {
    current,
    playing,
    loading,
    time,
    duration,
    repeat,
    shuffle,
    hasTrack,
    toggle,
    next,
    prev,
    seekPercent,
    cycleRepeat,
    toggleShuffle,
    openPlayer,
  } = usePlayer()

  const percent = duration > 0 ? Math.min(100, (time / duration) * 100) : 0
  const title = current ? current.title : 'No song selected'
  const artist = current ? current.artist || 'Unknown artist' : 'Choose a track to start listening'

  /* Clicking empty bar space opens the expanded view. */
  const onSurfaceClick = (e) => {
    if (!hasTrack) return
    if (e.target.closest('button, input, a, label, .pl-overlay')) return
    openPlayer()
  }

  return (
    <footer className={`player${loading ? ' is-loading' : ''}`} id="player" onClick={onSurfaceClick}>
      {/* LEFT: artwork + metadata */}
      <div className="player-info">
        <div className="player-cover">
          {current ? (
            <CoverArt track={current} placeholderClassName="player-cover-placeholder" placeholderSize={22} />
          ) : (
            <span className="player-cover-placeholder" aria-hidden="true">
              <Icon name="music" size={22} />
            </span>
          )}
        </div>
        <div className="player-meta">
          <div className="player-title" title={title}>{title}</div>
          <div className="player-artist" title={artist}>{artist}</div>
        </div>
      </div>

      {/* CENTER: primary transport + progress */}
      <div className="player-center">
        <div className="player-controls">
          <button
            type="button"
            className="btn-icon player-btn"
            title="Previous"
            aria-label="Previous track"
            disabled={!hasTrack}
            onClick={prev}
          >
            <Icon name="skip-back" size={18} />
          </button>

          <button
            type="button"
            className={`btn-icon player-btn player-btn-play${playing ? ' is-playing' : ''}`}
            aria-label={hasTrack ? (playing ? 'Pause' : 'Play') : 'Play (no song selected)'}
            title={playing ? 'Pause' : 'Play'}
            aria-pressed={playing}
            disabled={!hasTrack}
            onClick={toggle}
          >
            <span className="icon-state icon-state-play" aria-hidden="true">
              <Icon name="play" size={20} />
            </span>
            <span className="icon-state icon-state-pause" aria-hidden="true">
              <Icon name="pause" size={20} />
            </span>
          </button>

          <button
            type="button"
            className="btn-icon player-btn"
            title="Next"
            aria-label="Next track"
            disabled={!hasTrack}
            onClick={next}
          >
            <Icon name="skip-forward" size={18} />
          </button>
        </div>

        <div className="player-seek">
          <span className="player-time">{fmtDuration(time)}</span>
          <input
            type="range"
            min="0"
            max="100"
            step="0.1"
            value={percent}
            aria-label="Seek"
            disabled={!hasTrack || duration <= 0}
            onChange={(e) => seekPercent(Number(e.target.value))}
          />
          <span className="player-time">{fmtDuration(duration)}</span>
        </div>
      </div>

      {/* RIGHT: secondary actions */}
      <div className="player-right">
        <FavButton track={current} />
        <AddToPlaylistButton track={current} />
        <span className="player-right-divider" aria-hidden="true" />
        <button
          type="button"
          className={`btn-icon player-btn player-btn-shuffle${shuffle ? ' is-active' : ''}`}
          title={`Shuffle: ${shuffle ? 'On' : 'Off'}`}
          aria-label={`Shuffle: ${shuffle ? 'On' : 'Off'}`}
          aria-pressed={shuffle}
          data-shuffle={shuffle ? 'on' : 'off'}
          onClick={toggleShuffle}
        >
          <Icon name="shuffle" size={18} />
        </button>
        <button
          type="button"
          className={`btn-icon player-btn player-btn-repeat${repeat !== 'off' ? ' is-active' : ''}`}
          title={`Repeat: ${REPEAT_LABELS[repeat] || REPEAT_LABELS.off}`}
          aria-label={`Repeat: ${REPEAT_LABELS[repeat] || REPEAT_LABELS.off}`}
          data-repeat={repeat}
          onClick={cycleRepeat}
        >
          <Icon name={repeat === 'one' ? 'repeat-1' : 'repeat'} size={18} />
        </button>
        <button
          type="button"
          className="btn-icon player-btn player-expand"
          aria-label="Open now playing"
          title="Open now playing"
          disabled={!hasTrack}
          onClick={(e) => {
            e.stopPropagation()
            openPlayer()
          }}
        >
          <Icon name="chevron-up" size={18} />
        </button>
      </div>
    </footer>
  )
}
