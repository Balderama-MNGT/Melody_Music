import { Icon } from './Icons.jsx'
import CoverArt from './CoverArt.jsx'
import FavButton from './FavButton.jsx'
import { AddToPlaylistButton } from './PlaylistPicker.jsx'
import { usePlayer } from '../context/PlayerContext.jsx'
import { fmtDurationShort } from '../lib/format.js'

/** One song card (the grid used by Trending / Discover / Search results). */
export default function TrackCard({ track, queue, index = 0 }) {
  const { playQueue, current } = usePlayer()
  const isCurrent = Boolean(current && current.external_id === track.external_id)
  const list = queue || [track]

  const play = () => playQueue(list, index)

  const meta = [fmtDurationShort(track.duration), track.genre].filter(Boolean).join(' \u2022 ')

  return (
    <div className={`song-card audius-item${isCurrent ? ' is-current' : ''}`} data-external={track.external_id}>
      <button
        type="button"
        className="song-card-cover"
        aria-label={`Play ${track.title} by ${track.artist}`}
        onClick={play}
      >
        <CoverArt track={track} placeholderClassName="cover-placeholder" placeholderSize={28} />
        <span className="play-overlay" aria-hidden="true">
          <Icon name="play" size={22} />
        </span>
      </button>

      <div className="song-card-title">{track.title}</div>
      <div className="song-card-artist">{track.artist}</div>
      {meta ? <div className="song-card-meta">{meta}</div> : null}

      <div className="card-actions">
        <FavButton track={track} />
        <AddToPlaylistButton track={track} />
      </div>
    </div>
  )
}
