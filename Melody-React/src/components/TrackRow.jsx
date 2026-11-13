import { Icon } from './Icons.jsx'
import CoverArt from './CoverArt.jsx'
import FavButton from './FavButton.jsx'
import { AddToPlaylistButton } from './PlaylistPicker.jsx'
import { usePlayer } from '../context/PlayerContext.jsx'

/**
 * One track row (li.track) - the markup of home_track_row() / the PHP pages.
 *
 * track        - the track to show
 * queue        - the list Next/Previous should follow (defaults to [track])
 * index        - position of this track inside that queue
 * meta         - right-hand text (duration, "3 plays", "12 min ago", ...)
 * artistExtra  - node appended inside the artist line (e.g. the phone-only time)
 * rightNode    - extra control after the standard buttons (e.g. remove)
 * showAddPl    - show the "add to playlist" button (off inside a playlist)
 * suffix       - appended to the artist (" • Audius")
 */
export default function TrackRow({
  track,
  queue,
  index = 0,
  meta = '',
  artistExtra = null,
  rightNode = null,
  showAddPl = true,
  suffix = '',
  className = '',
}) {
  const { playQueue, current } = usePlayer()
  const isCurrent = Boolean(current && current.external_id === track.external_id)
  const list = queue || [track]

  const play = () => playQueue(list, index)

  return (
    <li
      className={`track audius-item${isCurrent ? ' is-current' : ''}${className ? ` ${className}` : ''}`}
      data-external={track.external_id}
    >
      <button
        type="button"
        className="track-play"
        aria-label={`Play ${track.title} by ${track.artist}`}
        onClick={play}
      >
        <Icon name="play" size={16} />
      </button>

      <CoverArt
        track={track}
        className="track-thumb"
        placeholderClassName="track-thumb placeholder-thumb"
        placeholderSize={20}
      />

      <div className="track-meta">
        <div className="track-title">{track.title}</div>
        <div className="track-artist">
          {track.artist}
          {suffix ? <span className="track-suffix">{suffix}</span> : null}
          {artistExtra}
        </div>
      </div>

      {meta ? <span className="track-plays">{meta}</span> : null}

      <FavButton track={track} />
      {showAddPl && <AddToPlaylistButton track={track} />}
      {rightNode}
    </li>
  )
}
