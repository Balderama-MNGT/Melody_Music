import { useEffect, useState } from 'react'
import { Icon } from './Icons.jsx'
import CoverArt from './CoverArt.jsx'
import { usePlayer } from '../context/PlayerContext.jsx'

/**
 * "Recommended for You" reads the SAME up-next queue the player advances from.
 * It only asks the shared refill helper for more songs when that queue is
 * genuinely empty - switching tracks never issues a search of its own.
 */
const LIMIT = 6

const INITIAL = { status: 'idle', tracks: [], query: '', error: '' }

export default function Recommendations({ track }) {
  const { upNext, enqueueAndPlay, refillRecommendations, recommendationError, clearRecommendationError } = usePlayer()
  const [state, setState] = useState(INITIAL)
  const [attempt, setAttempt] = useState(0)
  const externalId = track?.external_id || ''
  const upNextKey = (upNext || []).map((t) => t.external_id).join(',')

  useEffect(() => {
    if (!externalId) {
      setState(INITIAL)
      return undefined
    }
    /* Already queued: reuse it, no request - this is what keeps automatic
       next-track playback free of per-song searches. */
    if ((upNext || []).length) {
      clearRecommendationError()
      setState({ status: 'ready', tracks: upNext.slice(0, LIMIT), query: '', error: '' })
      return undefined
    }
    let alive = true
    setState({ status: 'loading', tracks: [], query: '', error: '' })
    refillRecommendations(track).then((list) => {
      if (!alive) return
      setState({ status: list.length ? 'ready' : 'empty', tracks: list.slice(0, LIMIT), query: '', error: '' })
    })
    return () => {
      alive = false
    }
  }, [externalId, upNextKey, attempt, refillRecommendations, clearRecommendationError])

  return (
    <section className="np-recs" aria-label="Recommended for You">
      <div className="np-recs-head">
        <h3>Recommended for You</h3>
        {state.status === 'ready' && (
          <span className="np-recs-sub">
            {track?.genre ? `more ${String(track.genre).toLowerCase()}` : 'similar music'}
          </span>
        )}
      </div>

      {state.status === 'idle' && (
        <p className="np-recs-msg">Start a song to see related music.</p>
      )}

      {state.status === 'loading' && (
        <div className="np-recs-list" aria-busy="true">
          {Array.from({ length: 4 }, (_, i) => (
            <div className="np-rec-item np-rec-skeleton" key={i} aria-hidden="true">
              <span className="np-rec-art" />
              <span className="np-rec-meta">
                <span className="np-rec-line" />
                <span className="np-rec-line np-rec-line-short" />
              </span>
            </div>
          ))}
        </div>
      )}

      {/* A failure is not "no related music". Keep the message specific and
          preserve a previously valid up-next queue above. */}
      {(recommendationError || state.status === 'error') && (
        <div className="np-recs-msg np-recs-error" role="status">
          <span>{recommendationError?.message || state.error}</span>
          <button type="button" className="btn btn-outline" onClick={() => setAttempt((n) => n + 1)}>
            Try again
          </button>
        </div>
      )}

      {!recommendationError && state.status === 'empty' && (
        <p className="np-recs-msg">No related songs found right now.</p>
      )}

      {state.status === 'ready' && (
        <div className="np-recs-list">
          {state.tracks.map((t) => (
            <button
              type="button"
              key={t.external_id}
              data-id={t.external_id}
              className="np-rec-item"
              title={`Play ${t.title} by ${t.artist}`}
              onClick={() => enqueueAndPlay(t)}
            >
              <span className="np-rec-art">
                <CoverArt
                  track={t}
                  placeholderClassName="np-rec-placeholder"
                  placeholderSize={16}
                />
              </span>
              <span className="np-rec-meta">
                <span className="np-rec-title">{t.title}</span>
                <span className="np-rec-artist">{t.artist || 'Unknown artist'}</span>
              </span>
              <Icon name="play" size={14} className="np-rec-play" />
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
