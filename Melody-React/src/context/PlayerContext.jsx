import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from './AuthContext.jsx'
import { useToast } from './ToastContext.jsx'
import { resolveStreamUrl } from '../lib/api.js'
import { recordPlay } from '../lib/db.js'

/**
 * The one music player - a direct port of assets/js/player.js.
 *
 * Every track that plays (Audius streams alike) goes through this context:
 * queue, next/previous, seeking, remembered volume, failure handling and
 * "log a play once per track start". The <audio> element lives here and is
 * never remounted while you move around the app, so the music keeps playing.
 */
const PlayerContext = createContext(null)

const VOLUME_KEY = 'melody:volume'
const REPEAT_KEY = 'melody:repeat'
/* off -> all -> one, in the order the button cycles through them */
const REPEAT_MODES = ['off', 'all', 'one']

function normalizeQueue(items) {
  return (items || []).map((it) => ({
    external_id: it.external_id || '',
    title: it.title || 'Untitled',
    artist: it.artist || '',
    cover: it.cover || '',
    mirrors: Array.isArray(it.mirrors) ? it.mirrors : [],
    genre: it.genre || '',
    duration: Number(it.duration) || 0,
    is_fav: Boolean(it.is_fav),
  }))
}

function readVolume() {
  try {
    const saved = parseFloat(localStorage.getItem(VOLUME_KEY))
    if (isFinite(saved) && saved >= 0 && saved <= 1) return saved
  } catch {
    /* private mode etc. */
  }
  return 1
}

function readRepeat() {
  try {
    const saved = localStorage.getItem(REPEAT_KEY)
    if (REPEAT_MODES.indexOf(saved) !== -1) return saved
  } catch {
    /* private mode etc. */
  }
  return 'off'
}

export function PlayerProvider({ children }) {
  const toast = useToast()
  const { session } = useAuth()

  const audioRef = useRef(null)
  if (audioRef.current === null && typeof window !== 'undefined') {
    audioRef.current = new Audio()
  }

  const [queue, setQueue] = useState([])
  const [index, setIndex] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolumeState] = useState(readVolume)
  const [repeat, setRepeat] = useState(readRepeat)

  const queueRef = useRef(queue)
  const indexRef = useRef(index)
  const repeatRef = useRef(repeat)
  const loggedRef = useRef(false)
  const errorHandledRef = useRef(false)
  const failStreakRef = useRef(0)
  const sessionRef = useRef(session)
  const toastRef = useRef(toast)

  queueRef.current = queue
  indexRef.current = index
  repeatRef.current = repeat
  sessionRef.current = session
  toastRef.current = toast

  const current = index >= 0 && index < queue.length ? queue[index] : null

  /* ------------------------------- transport ------------------------------- */

  const tryPlay = useCallback(() => {
    const a = audioRef.current
    if (!a) return
    const p = a.play()
    if (p && typeof p.catch === 'function') {
      p.catch((err) => {
        setLoading(false)
        // The browser wants a gesture first - leave the state honest.
        if (err && err.name === 'NotAllowedError') {
          setPlaying(false)
          return
        }
        if (err && err.name === 'AbortError') return // a newer load replaced it
        fail()
      })
    }
  }, [])

  /** A track that cannot be streamed: say so, then move on (never loop forever). */
  const fail = useCallback(() => {
    if (errorHandledRef.current) return
    errorHandledRef.current = true
    setLoading(false)
    setPlaying(false)

    const song = queueRef.current[indexRef.current]
    toastRef.current(
      `“${song ? song.title : 'This track'}” can’t be played right now. It may be unavailable.`,
      true
    )

    failStreakRef.current += 1
    const len = queueRef.current.length
    if (len > 1 && failStreakRef.current < len) {
      const idx = indexRef.current
      setTimeout(() => {
        if (indexRef.current === idx && queueRef.current.length > 1) {
          loadRef.current(idx + 1 < queueRef.current.length ? idx + 1 : 0, true)
        }
      }, 1400)
    }
  }, [])

  const load = useCallback((i, autoplay) => {
    const q = queueRef.current
    if (i < 0 || i >= q.length) return
    const song = q[i]

    errorHandledRef.current = false
    loggedRef.current = false
    indexRef.current = i
    setIndex(i)
    setTime(0)
    setDuration(Number(song.duration) || 0)

    const a = audioRef.current
    if (!a) return

    if (autoplay) setLoading(true)

    // The <audio> element cannot send an Authorization header, so ask our
    // authenticated function for the real media URL first, then hand that
    // to the audio element (Range/seeking keep working).
    resolveStreamUrl(song.external_id)
      .then((url) => {
        if (indexRef.current !== i) return // a newer track took over
        a.src = url
        if (autoplay) tryPlay()
        else setLoading(false)
      })
      .catch((err) => {
        if (indexRef.current !== i) return
        setLoading(false)
        if (err && err.status === 401) {
          setPlaying(false)
          toastRef.current('Your session has expired. Please log in again.', true)
          return
        }
        fail()
      })
  }, [tryPlay, fail])

  const loadRef = useRef(load)
  loadRef.current = load

  const playQueue = useCallback(
    (items, startIndex = 0) => {
      const normalized = normalizeQueue(items)
      if (!normalized.length) return
      queueRef.current = normalized
      setQueue(normalized)
      failStreakRef.current = 0
      const i = Math.max(0, Math.min(Number(startIndex) || 0, normalized.length - 1))
      load(i, true)
    },
    [load]
  )

  const next = useCallback(() => {
    const q = queueRef.current
    if (!q.length) return
    load(indexRef.current + 1 < q.length ? indexRef.current + 1 : 0, true)
  }, [load])

  const prev = useCallback(() => {
    const q = queueRef.current
    if (!q.length) return
    const a = audioRef.current
    if (a && a.currentTime > 3) {
      a.currentTime = 0
      return
    }
    load(indexRef.current > 0 ? indexRef.current - 1 : q.length - 1, true)
  }, [load])

  const toggle = useCallback(() => {
    const a = audioRef.current
    if (!a) return
    if (!a.src && queueRef.current.length) {
      load(indexRef.current >= 0 ? indexRef.current : 0, true)
      return
    }
    if (a.paused) {
      setLoading(true)
      tryPlay()
    } else {
      a.pause()
    }
  }, [load, tryPlay])

  const seekPercent = useCallback((percent) => {
    const a = audioRef.current
    if (!a || !a.duration || !isFinite(a.duration)) return
    a.currentTime = (Number(percent) / 100) * a.duration
  }, [])

  const setVolume = useCallback((value) => {
    const v = Math.max(0, Math.min(1, Number(value)))
    const a = audioRef.current
    if (a) a.volume = v
    setVolumeState(v)
    try {
      localStorage.setItem(VOLUME_KEY, String(v))
    } catch {
      /* private mode etc. */
    }
  }, [])

  /**
   * Off -> All -> One -> Off. Only the mode itself changes: the queue, the
   * current track, its position and the playing state are never touched.
   */
  const cycleRepeat = useCallback(() => {
    const mode = REPEAT_MODES[(REPEAT_MODES.indexOf(repeatRef.current) + 1) % REPEAT_MODES.length]
    repeatRef.current = mode
    setRepeat(mode)
    try {
      localStorage.setItem(REPEAT_KEY, mode)
    } catch {
      /* private mode etc. */
    }
  }, [])

  /* Repeat One: let the <audio> element restart the track at its end - it
     needs no 'ended' event, no reload and it keeps the exact position/state. */
  useEffect(() => {
    const a = audioRef.current
    if (a) a.loop = repeat === 'one'
  }, [repeat])

  /* ---------------------------- audio events ---------------------------- */

  useEffect(() => {
    const a = audioRef.current
    if (!a) return undefined

    a.volume = volume

    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onWaiting = () => setLoading(true)
    const onCanPlay = () => setLoading(false)
    const onPlaying = () => {
      setLoading(false)
      failStreakRef.current = 0

      // One history row per track start (best-effort: playback never waits on it).
      const song = queueRef.current[indexRef.current]
      if (song && !loggedRef.current) {
        loggedRef.current = true
        if (sessionRef.current && song.external_id) {
          recordPlay(song).catch(() => {})
        }
      }
    }
    const onError = () => fail()
    const onEnded = () => {
      const mode = repeatRef.current
      const q = queueRef.current
      if (!q.length) return
      // Repeat One never normally reaches this (the element loops on its own),
      // but a mode switched at the very last moment still restarts the song.
      if (mode === 'one') {
        a.currentTime = 0
        tryPlay()
        return
      }
      // Repeat All: wrap the queue back to its first track.
      if (mode === 'all') {
        nextRef.current()
        return
      }
      // Repeat Off: play through the queue, then stop on the last track.
      if (indexRef.current < q.length - 1) nextRef.current()
      else {
        a.currentTime = 0
        setPlaying(false)
      }
    }
    const onLoadedMetadata = () => {
      if (isFinite(a.duration)) setDuration(a.duration)
    }
    const onTimeUpdate = () => {
      if (a.duration && isFinite(a.duration)) setTime(a.currentTime)
    }

    a.addEventListener('play', onPlay)
    a.addEventListener('pause', onPause)
    a.addEventListener('waiting', onWaiting)
    a.addEventListener('canplay', onCanPlay)
    a.addEventListener('playing', onPlaying)
    a.addEventListener('error', onError)
    a.addEventListener('ended', onEnded)
    a.addEventListener('loadedmetadata', onLoadedMetadata)
    a.addEventListener('timeupdate', onTimeUpdate)

    return () => {
      a.removeEventListener('play', onPlay)
      a.removeEventListener('pause', onPause)
      a.removeEventListener('waiting', onWaiting)
      a.removeEventListener('canplay', onCanPlay)
      a.removeEventListener('playing', onPlaying)
      a.removeEventListener('error', onError)
      a.removeEventListener('ended', onEnded)
      a.removeEventListener('loadedmetadata', onLoadedMetadata)
      a.removeEventListener('timeupdate', onTimeUpdate)
      // The provider is going away (signed out): stop the audio for good.
      a.pause()
      a.removeAttribute('src')
      a.load()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const nextRef = useRef(next)
  nextRef.current = next

  useEffect(() => {
    const a = audioRef.current
    if (a) a.volume = volume
  }, [volume])

  /* ----------------------- signed out -> silence ----------------------- */
  // The player sits above the routes, so it outlives a logout - watch the
  // session and stop everything the moment it goes away (logout or expiry).
  useEffect(() => {
    if (session) return
    const a = audioRef.current
    if (!a) return
    errorHandledRef.current = true // dropping the src is not a playback failure
    a.pause()
    a.removeAttribute('src')
    try {
      a.load() // abort whatever was still streaming
    } catch {
      /* very old browsers */
    }
    queueRef.current = []
    setQueue([])
    indexRef.current = -1
    setIndex(-1)
    setPlaying(false)
    setLoading(false)
    setTime(0)
    setDuration(0)
    failStreakRef.current = 0
    loggedRef.current = false
  }, [session])

  /* Space toggles playback (unless typing, or a dialog owns the keyboard). */
  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== 'Space') return
      const tag = document.activeElement?.tagName || ''
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) return
      if (document.getElementById('plPicker')) return
      e.preventDefault()
      toggleRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const toggleRef = useRef(toggle)
  toggleRef.current = toggle

  const value = useMemo(
    () => ({
      queue,
      index,
      current,
      playing,
      loading,
      time,
      duration,
      volume,
      repeat,
      hasTrack: Boolean(current),
      playQueue,
      toggle,
      next,
      prev,
      seekPercent,
      setVolume,
      cycleRepeat,
    }),
    [queue, index, current, playing, loading, time, duration, volume, repeat, playQueue, toggle, next, prev, seekPercent, setVolume, cycleRepeat]
  )

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
}

export function usePlayer() {
  const ctx = useContext(PlayerContext)
  if (!ctx) throw new Error('usePlayer must be used inside <PlayerProvider>')
  return ctx
}
