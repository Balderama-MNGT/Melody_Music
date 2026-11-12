import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icons.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { fetchPlaylistOptions, addTrackToPlaylist, createPlaylist } from '../lib/db.js'

/** Only one picker may be open at a time (the old player.js behaved the same). */
let closeCurrentlyOpen = null

/**
 * "Add to playlist" dialog - a port of the picker built by player.js.
 * Offers the user's playlists plus "create one on the fly", then closes.
 */
export default function PlaylistPicker({ track, onClose }) {
  const toast = useToast()
  const [playlists, setPlaylists] = useState(null) // null = loading
  const [status, setStatus] = useState('')
  const [error, setError] = useState(false)
  const boxRef = useRef(null)

  useEffect(() => {
    if (closeCurrentlyOpen) closeCurrentlyOpen()
    closeCurrentlyOpen = onClose

    let alive = true
    fetchPlaylistOptions()
      .then((rows) => alive && setPlaylists(rows))
      .catch((err) => {
        if (!alive) return
        setPlaylists([])
        setError(true)
        setStatus(err?.message || 'Could not load your playlists.')
      })

    return () => {
      alive = false
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
    setStatus(name ? 'Creating playlist…' : 'Adding…')
    setError(false)
    if (button) button.disabled = true
    try {
      let targetId = playlistId
      let targetName = name
      if (!playlistId) {
        const created = await createPlaylist(name)
        targetId = created.id
        targetName = created.name
      }
      const res = await addTrackToPlaylist(targetId, track)
      toast(res.added ? `Added to “${targetName}”.` : `Already in “${targetName}”.`)
      onClose()
    } catch (err) {
      setError(true)
      setStatus(err?.message || 'Could not add to the playlist.')
      if (button) button.disabled = false
    }
  }

  const empty = playlists && playlists.length === 0

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
          {playlists === null && <p className="pl-empty">Loading your playlists…</p>}
          {empty && <p className="pl-empty">You have no playlists yet - create one below.</p>}
          {(playlists || []).map((pl) => (
            <button
              key={pl.id}
              type="button"
              className="pl-item"
              onClick={(e) => addTo(pl.id, '', e.currentTarget)}
            >
              {pl.name}
            </button>
          ))}
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

  if (!track || !track.external_id) return null

  return (
    <>
      <button
        type="button"
        className={className}
        aria-label="Add to playlist"
        title="Add to playlist"
        onClick={() => setOpen(true)}
      >
        <Icon name="list-plus" size={18} />
      </button>
      {open && <PlaylistPicker track={track} onClose={() => setOpen(false)} />}
    </>
  )
}
