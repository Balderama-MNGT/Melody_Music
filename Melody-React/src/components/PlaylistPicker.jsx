import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icons.jsx'
import { usePlaylists } from '../context/PlaylistsContext.jsx'

/** Only one picker may be open at a time (the old player.js behaved the same). */
let closeCurrentlyOpen = null

/**
 * "Add to playlist" dialog - a port of the picker built by player.js.
 * Offers the user's playlists plus "create one on the fly", then closes.
 */
export default function PlaylistPicker({ track, onClose }) {
  const { playlists, loading, addTrack, createAndAdd } = usePlaylists()
  const [status, setStatus] = useState('')
  const [error, setError] = useState(false)
  const boxRef = useRef(null)

  useEffect(() => {
    if (closeCurrentlyOpen) closeCurrentlyOpen()
    closeCurrentlyOpen = onClose
    return () => {
      if (closeCurrentlyOpen === onClose) closeCurrentlyOpen = null
    }
  }, [onClose])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    const first = boxRef.current?.querySelector('.pl-item, .pl-new input')
    if (first) first.focus()
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  async function addTo(playlistId, name, button) {
    const existing = (playlists || []).find((p) => p.id === playlistId)
    if (existing && (existing.trackIds || []).includes(track.external_id)) {
      setError(true)
      setStatus(`“${track.title}” is already in “${existing.name}”.`)
      return
    }
    setStatus(name ? 'Creating playlist…' : 'Adding…')
    setError(false)
    if (button) button.disabled = true
    try {
      /* The create form passes playlistId = 0; an existing row always has an id. */
      const res = playlistId ? await addTrack(playlistId, track) : await createAndAdd(name, track)
      if (!res.added) {
        setError(true)
        setStatus(`“${track.title}” is already in this playlist.`)
        if (button) button.disabled = false
        return
      }
      onClose()
    } catch (err) {
      setError(true)
      setStatus(err?.message || 'Could not add to the playlist.')
      if (button) button.disabled = false
    }
  }

  const empty = !loading && playlists && playlists.length === 0

  return createPortal(
    <div
      className="pl-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="pl-box"
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="plPickerTitle"
      >
        <h2 id="plPickerTitle">Add to playlist</h2>

        <div className="pl-list">
          {loading && <p className="pl-empty">Loading your playlists…</p>}
          {empty && <p className="pl-empty">You have no playlists yet - create one below.</p>}
          {(playlists || []).map((pl) => {
            const added = (pl.trackIds || []).includes(track.external_id)
            return (
              <button
                key={pl.id}
                type="button"
                className={`pl-item${added ? ' is-added' : ''}`}
                onClick={(e) => addTo(pl.id, pl.name, e.currentTarget)}
              >
                <span className="pl-item-name">{pl.name}</span>
                {added && (
                  <span className="pl-added">
                    <Icon name="check" size={14} /> Added
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <form
          className="pl-new"
          onSubmit={(e) => {
            e.preventDefault()
            const input = e.currentTarget.elements.name
            const name = input.value.trim()
            if (!name) {
              input.focus()
              return
            }
            addTo(0, name, e.currentTarget.querySelector('button'))
          }}
        >
          <input
            type="text"
            name="name"
            maxLength={100}
            placeholder="New playlist name…"
            aria-label="New playlist name"
          />
          <button type="submit" className="btn btn-primary">
            Create &amp; add
          </button>
        </form>

        <p className={`pl-status${error ? ' pl-status-error' : ''}`} role="status">
          {status}
        </p>

        <button type="button" className="btn btn-outline pl-cancel" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>,
    document.body
  )
}

/** The "add to playlist" icon button used on cards, rows and the player bar. */
export function AddToPlaylistButton({ track, className = 'btn btn-icon btn-addpl' }) {
  const [open, setOpen] = useState(false)
  const { isInAnyPlaylist } = usePlaylists()
  const added = Boolean(track?.external_id && isInAnyPlaylist(track.external_id))

  if (!track || !track.external_id) return null

  return (
    <>
      <button
        type="button"
        className={`${className}${added ? ' is-in-playlist' : ''}`}
        aria-label={added ? 'Added to a playlist - add to another' : 'Add to playlist'}
        title={added ? 'Added to a playlist' : 'Add to playlist'}
        onClick={() => setOpen(true)}
      >
        <Icon name={added ? 'check' : 'list-plus'} size={18} />
      </button>
      {open && <PlaylistPicker track={track} onClose={() => setOpen(false)} />}
    </>
  )
}
