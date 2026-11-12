import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icons.jsx'
import CoverArt from './CoverArt.jsx'
import { audiusRequest } from '../lib/api.js'
import { usePlayer } from '../context/PlayerContext.jsx'

const DEBOUNCE_MS = 300
const MIN_TERM = 2
const SUGGEST_LIMIT = 6

/**
 * The shared search field - topbar and full search page.
 *
 * On top of the plain box: live Audius suggestions (debounced while you
 * type, ArrowUp/ArrowDown to highlight, Enter to play the track, Esc to
 * close or clear), a clear (x) button and a spinner while suggestions
 * load. Enter without a highlighted suggestion submits to the results
 * page, exactly like the old form.
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
  const [items, setItems] = useState([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [busy, setBusy] = useState(false)
  const wrapRef = useRef(null)
  const inputRef = useRef(null)
  const reqRef = useRef(0)

  const term = value.trim()

  /* Debounced suggestions: one request per pause in typing. */
  useEffect(() => {
    let alive = true
    const id = ++reqRef.current

    if (term.length < MIN_TERM) {
      setItems([])
      setActive(-1)
      setOpen(false)
      setBusy(false)
      return () => {
        alive = false
      }
    }

    setBusy(true)
    const timer = setTimeout(() => {
      audiusRequest({ action: 'search', q: term, limit: String(SUGGEST_LIMIT) })
        .then((data) => {
          if (!alive || reqRef.current !== id) return // stale response
          const tracks = data.tracks || []
          setItems(tracks)
          setActive(-1)
          setOpen(tracks.length > 0)
          setBusy(false)
        })
        .catch(() => {
          if (!alive || reqRef.current !== id) return
          setItems([])
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

  function pick(track) {
    const i = items.findIndex((t) => t.external_id === track.external_id)
    setOpen(false)
    setActive(-1)
    playQueue(items, i < 0 ? 0 : i) // queue the suggestions, start here
  }

  function submit(e) {
    e.preventDefault()
    setOpen(false)
    setActive(-1)
    onSubmit(term)
  }

  function clear() {
    onChange('')
    setItems([])
    setActive(-1)
    setOpen(false)
    setBusy(false)
    inputRef.current?.focus()
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      if (open) {
        setOpen(false)
        setActive(-1)
      } else if (value) {
        clear()
      }
      return
    }
    if (!open || items.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => (i + 1) % items.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => (i <= 0 ? items.length - 1 : i - 1))
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault()
      pick(items[active])
    }
  }

  return (
    <form
      ref={wrapRef}
      className={`search-form${formClassName ? ` ${formClassName}` : ''}`}
      role="search"
      onSubmit={submit}
    >
      <span className="search-icon" aria-hidden="true">
        {busy ? <span className="spinner search-spinner" /> : <Icon name="search" size={18} />}
      </span>
      <label className="visually-hidden" htmlFor={inputId}>
        Search songs, artists, albums
      </label>
      <span className="search-field">
        <input
          ref={inputRef}
          type="text"
          id={inputId}
          name="q"
          className={`search-input${value ? ' has-clear' : ''}`}
          placeholder="Search songs, artists, albums..."
          value={value}
          onChange={(e) => onChange(e.target.value)}
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

      {open && items.length > 0 ? (
        <div className="search-suggest" id={`${inputId}-suggest`} role="listbox" aria-label="Suggestions">
          {items.map((track, i) => (
            <button
              key={track.external_id}
              id={`${inputId}-opt-${i}`}
              type="button"
              role="option"
              aria-selected={active === i}
              className={`suggest-item${active === i ? ' is-active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()} // keep focus in the box
              onClick={() => pick(track)}
            >
              <CoverArt
                track={track}
                className="suggest-cover"
                placeholderClassName="suggest-cover suggest-ph"
                placeholderSize={14}
              />
              <span className="suggest-meta">
                <span className="suggest-title">{track.title}</span>
                <span className="suggest-artist">{track.artist}</span>
              </span>
              <span className="suggest-play" aria-hidden="true">
                <Icon name="play" size={13} />
              </span>
            </button>
          ))}
          <button
            type="button"
            className="suggest-all"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setOpen(false)
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
