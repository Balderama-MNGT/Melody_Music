import { Icon } from './Icons.jsx'
import CoverArt from './CoverArt.jsx'
import { usePlayer } from '../context/PlayerContext.jsx'

/**
 * The "Playlist Songs" view shown in the expanded player while a saved
 * playlist is the active playback context. It lists ONLY the active playlist
 * queue in its saved order and never fetches recommendations.
 */
export default function PlaylistSongs() {
  const { queue, current, activePlaylist, playAt } = usePlayer()

  return (
    <section className="np-recs" aria-label="Playlist songs">
      <div className="np-recs-head">
        <h3>{activePlaylist?.name || 'Playlist Songs'}</h3>
        <span className="np-recs-sub">{queue.length} songs</span>
      </div>
      <div className="np-recs-list">
        {queue.map((track, i) => {
          const isCurrent = Boolean(current && current.external_id === track.external_id)
          return (
            <button
              type="button"
              key={`${track.external_id}-${i}`}
              data-id={track.external_id}
              className={`np-rec-item${isCurrent ? ' is-current' : ''}`}
              aria-current={isCurrent ? 'true' : undefined}
              title={`Play ${track.title} by ${track.artist}`}
              onClick={() => playAt(i)}
            >
              <span className="np-rec-art">
                <CoverArt
                  track={track}
                  placeholderClassName="np-rec-placeholder"
                  placeholderSize={16}
                />
              </span>
              <span className="np-rec-meta">
                <span className="np-rec-title">{track.title}</span>
                <span className="np-rec-artist">{track.artist || 'Unknown artist'}</span>
              </span>
              <Icon name="play" size={14} className="np-rec-play" />
            </button>
          )
        })}
      </div>
    </section>
  )
}
