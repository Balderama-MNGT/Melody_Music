import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Icon } from '../components/Icons.jsx'
import TrackRow from '../components/TrackRow.jsx'
import ConfirmDialog from '../components/ConfirmDialog.jsx'
import { EmptyState, ErrorState, LoadingState } from '../components/States.jsx'
import { usePlayer } from '../context/PlayerContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import {
  deletePlaylist,
  fetchPlaylist,
  fetchPlaylistTracks,
  removeTrackFromPlaylist,
  renamePlaylist,
} from '../lib/db.js'
import { plural } from '../lib/format.js'

/**
 * One playlist - the detail view of pages/playlists.php: play all, rename,
 * delete, and remove any track from the list.
 * RLS guarantees the playlist belongs to the signed-in user: a playlist id
 * from someone else simply comes back as "not found".
 */
export default function PlaylistDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { playQueue } = usePlayer()

  const [state, setState] = useState('loading') // loading | ready | error | missing
  const [error, setError] = useState('')
  const [playlist, setPlaylist] = useState(null)
  const [tracks, setTracks] = useState([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const load = useCallback(() => {
    setState('loading')
    setError('')
    Promise.all([fetchPlaylist(id), fetchPlaylistTracks(id)])
      .then(([pl, rows]) => {
        if (!pl) {
          setState('missing')
          return
        }
        setPlaylist(pl)
        setName(pl.name)
        setTracks(rows)
        setState('ready')
      })
      .catch((err) => {
        setError(err?.message || 'This playlist could not be loaded. Please try again.')
        setState('error')
      })
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  async function rename(e) {
    e.preventDefault()
    const value = name.trim()
    if (!value || busy || !playlist) return
    setBusy(true)
    try {
      await renamePlaylist(playlist.id, value)
      setPlaylist({ ...playlist, name: value })
      toast('Playlist renamed.')
    } catch (err) {
      setName(playlist.name)
      toast(err?.message || 'Could not rename the playlist.', true)
    } finally {
      setBusy(false)
    }
  }

  async function remove(track) {
    try {
      await removeTrackFromPlaylist(playlist.id, track.external_id)
      setTracks((rows) => rows.filter((r) => r.external_id !== track.external_id))
      toast(`Removed “${track.title}”.`)
    } catch (err) {
      toast(err?.message || 'Could not remove that track.', true)
    }
  }

  async function removeConfirmed() {
    setConfirmDelete(false)
    try {
      await deletePlaylist(playlist.id)
      toast('Playlist deleted.')
      navigate('/app/playlists')
    } catch (err) {
      toast(err?.message || 'Could not delete the playlist.', true)
    }
  }

  if (state === 'missing') {
    return (
      <section className="page">
        <p className="empty">Playlist not found.</p>
      </section>
    )
  }

  return (
    <section className="page">
      <p>
        <Link className="btn btn-outline" to="/app/playlists">
          <Icon name="chevron-left" size={16} /> <span>All playlists</span>
        </Link>
      </p>

      {state === 'loading' && <LoadingState label="Loading playlist…" />}
      {state === 'error' && <ErrorState message={error} onRetry={load} />}

      {state === 'ready' && (
        <>
          <h1 className="page-title">
            <Icon name="list-music" size={24} /> <span>{playlist.name}</span>
          </h1>
          <p className="results-count">{plural(tracks.length, 'song', 'songs')}</p>

          <div className="playlist-tools">
            {tracks.length > 0 && (
              <button type="button" className="btn btn-primary" onClick={() => playQueue(tracks, 0)}>
                <Icon name="play" size={16} /> <span>Play all</span>
              </button>
            )}

            <form className="inline-form playlist-rename" onSubmit={rename}>
              <label className="visually-hidden" htmlFor="renamePlaylist">
                Playlist name
              </label>
              <input
                type="text"
                id="renamePlaylist"
                name="name"
                maxLength={100}
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <button type="submit" className="btn btn-outline" disabled={busy}>
                <Icon name="pencil" size={16} /> <span>Rename</span>
              </button>
            </form>

            <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
              <Icon name="trash-2" size={16} /> <span>Delete playlist</span>
            </button>
          </div>

          {tracks.length === 0 ? (
            <EmptyState
              icon={<Icon name="music" size={22} />}
              title="This playlist is empty"
              text={
                <>
                  Use the <strong>add to playlist</strong> button on any song (including Audius
                  tracks) to build it out.
                </>
              }
            >
              <Link className="btn btn-primary" to="/app">
                Find music
              </Link>
            </EmptyState>
          ) : (
            <ul className="track-list">
              {tracks.map((t, i) => (
                <TrackRow
                  key={t.external_id}
                  track={t}
                  queue={tracks}
                  index={i}
                  showAddPl={false}
                  suffix=" • Audius"
                  rightNode={
                    <button
                      type="button"
                      className="btn btn-icon"
                      title="Remove from playlist"
                      aria-label={`Remove ${t.title} from playlist`}
                      onClick={() => remove(t)}
                    >
                      <Icon name="x" size={18} />
                    </button>
                  }
                />
              ))}
            </ul>
          )}
        </>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this playlist?"
          message="The songs stay in your library."
          confirmText="Delete playlist"
          cancelText="Cancel"
          onConfirm={removeConfirmed}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </section>
  )
}
