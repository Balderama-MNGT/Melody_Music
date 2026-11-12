import { Icon } from './Icons.jsx'
import CoverArt from './CoverArt.jsx'
import FavButton from './FavButton.jsx'
import { AddToPlaylistButton } from './PlaylistPicker.jsx'
import { usePlayer } from '../context/PlayerContext.jsx'
import { fmtDuration } from '../lib/format.js'

/**
 * Bottom player bar - the React port of includes/player.php + assets/js/player.js
 * markup. All transport state comes from PlayerContext, which owns the single
 * <audio> element so the music never stops while you move between pages.
 */
export default function Player() {
  const {
    current,
    playing,
    loading,
    time,
    duration,
    volume,
    hasTrack,
    toggle,
    next,
    prev,
    seekPercent,
    setVolume,
  } = usePlayer()

  const percent = duration > 0 ? Math.min(100, (time / duration) * 100) : 0

  return (
    <footer className={`player${loading ? ' is-loading' : ''}`} id="player">
      {/* LEFT: now playing */}
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
          <div className="player-title">{current ? current.title : 'No song selected'}</div>
          <div className="player-artist">
            {current ? current.artist || 'Unknown artist' : 'Choose a track to start listening'}
          </div>
        </div>
        <FavButton track={current} />
        <AddToPlaylistButton track={current} />
      </div>

      {/* CENTER: transport + progress */}
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

      {/* RIGHT: volume */}
      <div className="player-volume">
        <span className="player-volume-icon" aria-hidden="true">
          <Icon name={volume <= 0 ? 'volume-x' : 'volume-2'} size={18} />
        </span>
        <label className="visually-hidden" htmlFor="volumeBar">
          Volume
        </label>
        <input
          id="volumeBar"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
        />
      </div>
    </footer>
  )
}
