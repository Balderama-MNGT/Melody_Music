import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icons.jsx'
import CoverArt from './CoverArt.jsx'
import { youtubeRequest } from '../lib/api.js'
import { usePlayer } from '../context/PlayerContext.jsx'

const DEBOUNCE_MS = 300
const MIN_TERM = 2
const SUGGEST_LIMIT = 6

/**
 * The app's one search field - it lives on the Search page, directly under
 * that page's title, so it is the only box that can ever drive ?q=.
 *
 * On top of the plain box: live suggestions (debounced while you type,
 * ArrowUp/ArrowDown to highlight, Enter to play the highlighted song or take
 * the artist to the results, Esc to close or clear), a clear (x) button,
 * a Search button and a spinner while suggestions load.
 *
 * Two states are kept apart on purpose:
 *   - typing   -> the list may open (only while the field is the one being
 *                 typed in, so text the URL writes into it never pops up);
 *   - submitted-> Enter took the user to the results; the list stays shut
 *                 until they type again, and any request still in flight is
 *                 cancelled so it cannot reopen over the results.
 */
export default function SearchBox({
  value,
  onChange,
  onSubmit,
  inputId = 'searchBox',
  autoFocus = false,
  formClassName = '',
}) {
  const { playQueue } = usePlayer()
  const [items, setItems] = useState([]) // song suggestions (playable)
  const [artists, setArtists] = useState([]) // artist matches (navigate)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [busy, setBusy] = useState(false)
  const wrapRef = useRef(null)
  const inputRef = useRef(null)
  const reqRef = useRef(0)
  /* Set by Enter/submit and by an artist pick; cleared by the next keystroke.
     While it is true the query has already been sent to the results page, so
     the list must not come back on its own. */
  const submittedRef = useRef(false)

  const term = value.trim()

  /* Debounced suggestions: one request per pause in typing. */
  useEffect(() => {
    let alive = true
    const id = ++reqRef.current

    /* Suggestions belong to typing. Never open them for text the URL seeded
       into the field, never while someone is not actually in the field, and
       never after a search has been submitted. */
    const inField = typeof document !== 'undefined' && document.activeElement === inputRef.current
    if (term.length < MIN_TERM || submittedRef.current || !inField) {
      setItems([])
      setArtists([])
      setActive(-1)
      setOpen(false)
      setBusy(false)
      return () => {
        alive = false
      }
    }

    setBusy(true)
    const timer = setTimeout(() => {
      youtubeRequest({ action: 'search', q: term, limit: String(SUGGEST_LIMIT) })
        .then((data) => {
          if (!alive || reqRef.current !== id) return // stale response
          /* The field was left or the search was submitted while we waited:
             the answer is no longer wanted. */
          if (submittedRef.current || document.activeElement !== inputRef.current) {
            setItems([])
            setArtists([])
            setActive(-1)
            setOpen(false)
            setBusy(false)
            return
          }
          const tracks = data.tracks || []
          const names = artistHits(tracks, term)
          setItems(tracks)
          setArtists(names)
          setActive(-1)
          setOpen(tracks.length > 0 || names.length > 0)
          setBusy(false)
        })
        .catch(() => {
          if (!alive || reqRef.current !== id) return
          setItems([])
          setArtists([])
          setActive(-1)
          setOpen(false)
          setBusy(false)
        })
    }, DEBOUNCE_MS)

    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [term])

  /* Clicking anywhere outside closes the list. */
  useEffect(() => {
    if (!open) return undefined
    function onDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  /* Songs first, artists after - one queue of options for the keyboard. */
  const options = [
    ...items.map((t) => ({ type: 'track', key: `t:${t.external_id}`, track: t })),
    ...artists.map((a) => ({ type: 'artist', key: `a:${a.key}`, artist: a })),
  ]

  function pick(option) {
    reqRef.current++ // nothing left in flight may reopen the list after a choice
    setOpen(false)
    setActive(-1)
    if (option.type === 'artist') {
      submittedRef.current = true // this navigates to the results, like Enter
      onSubmit(option.artist.name)
      return
    }
    const i = items.findIndex((t) => t.external_id === option.track.external_id)
    playQueue(items, i < 0 ? 0 : i) // queue the suggestions, start here
  }

  function submit(e) {
    e.preventDefault()
    submittedRef.current = true // query sent: the list must not come back
    reqRef.current++ // drop a response that is still on its way
    setOpen(false)
    setActive(-1)
    setBusy(false)
    onSubmit(term)
  }

  function clear() {
    submittedRef.current = false // editing again
    onChange('')
    reqRef.current++
    setItems([])
    setArtists([])
    setActive(-1)
    setOpen(false)
    setBusy(false)
    inputRef.current?.focus()
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      /* Dismiss this layer only: the shell listens for Escape too (it closes
         the phone drawer), so stopping the event here lets Escape walk down
         this list, then the typed value, before anything else reacts. */
      if (open) {
        e.stopPropagation()
        setOpen(false)
        setActive(-1)
      } else if (value) {
        e.stopPropagation()
        clear()
      }
      return
    }
    if (!open || options.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % options.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i <= 0 ? options.length - 1 : i - 1))
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault()
      pick(options[active])
    }
  }

  return (
    <form
      ref={wrapRef}
      className={`search-form${formClassName ? ` ${formClassName}` : ''}`}
      role="search"
      onSubmit={submit}
    >
      <label className="visually-hidden" htmlFor={inputId}>
        Search songs, artists, albums
      </label>
      <span className="search-field">
        {/* Inside the field, not the form: it must line up with the input even
            where the row wraps into two lines (input over button on phones). */}
        <span className="search-icon" aria-hidden="true">
          {busy ? <span className="spinner search-spinner" /> : <Icon name="search" size={18} />}
        </span>
        <input
          ref={inputRef}
          type="text"
          id={inputId}
          name="q"
          className={`search-input${value ? ' has-clear' : ''}`}
          placeholder="What do you want to listen to?"
          value={value}
          onChange={(e) => {
            submittedRef.current = false // typing again: suggestions allowed
            onChange(e.target.value)
          }}
          onKeyDown={onKeyDown}
          onBlur={(e) => {
            if (!wrapRef.current?.contains(e.relatedTarget)) {
              setOpen(false)
              setActive(-1)
            }
          }}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${inputId}-suggest`}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${inputId}-opt-${active}` : undefined}
          autoFocus={autoFocus}
        />
        {value ? (
          <button type="button" className="search-clear" aria-label="Clear search" onClick={clear}>
            <Icon name="x" size={14} />
          </button>
        ) : null}
      </span>
      <button type="submit" className="btn btn-primary search-btn">
        Search
      </button>

      {open && options.length > 0 ? (
        <div className="search-suggest" id={`${inputId}-suggest`} role="listbox" aria-label="Suggestions">
          {options.map((option, i) => (
            <button
              key={option.key}
              id={`${inputId}-opt-${i}`}
              type="button"
              role="option"
              aria-selected={active === i}
              className={`suggest-item${active === i ? ' is-active' : ''}${option.type === 'artist' ? ' suggest-artist-item' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()} // keep focus in the box
              onClick={() => pick(option)}
            >
              {option.type === 'artist' ? (
                <>
                  <span className="suggest-cover suggest-ph" aria-hidden="true">
                    <Icon name="users" size={16} />
                  </span>
                  <span className="suggest-meta">
                    <span className="suggest-title">{option.artist.name}</span>
                    <span className="suggest-artist">Artist</span>
                  </span>
                  <span className="suggest-play" aria-hidden="true">
                    <Icon name="chevron-right" size={14} />
                  </span>
                </>
              ) : (
                <>
                  <CoverArt
                    track={option.track}
                    className="suggest-cover"
                    placeholderClassName="suggest-cover suggest-ph"
                    placeholderSize={14}
                  />
                  <span className="suggest-meta">
                    <span className="suggest-title">{option.track.title}</span>
                    <span className="suggest-artist">{option.track.artist}</span>
                  </span>
                  <span className="suggest-play" aria-hidden="true">
                    <Icon name="play" size={13} />
                  </span>
                </>
              )}
            </button>
          ))}
          <button
            type="button"
            className="suggest-all"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              submittedRef.current = true
              reqRef.current++
              setOpen(false)
              setActive(-1)
              onSubmit(term)
            }}
          >
            <Icon name="search" size={14} />
            <span>See all results for &ldquo;{term}&rdquo;</span>
          </button>
        </div>
      ) : null}
    </form>
  )
}

/**
 * The artists named in a search response that match the term.
 *
 * Derived from the songs we already fetched - no second API call, so typing
 * stays one debounced request no matter how many kinds of suggestion show up.
 */
function artistHits(tracks, term) {
  const needle = term.toLowerCase()
  const seen = new Set()
  const out = []
  for (const t of tracks) {
    const name = String(t.artist || '').trim()
    const id = String(t.artist_id || '')
    const key = (id || name).toLowerCase()
    if (!name || seen.has(key)) continue
    if (!name.toLowerCase().includes(needle)) continue
    seen.add(key)
    out.push({ key, name, id, cover: t.cover || '' })
    if (out.length >= 2) break
  }
  return out
}
