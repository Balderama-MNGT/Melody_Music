import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useAuth } from './AuthContext.jsx'
import { useToast } from './ToastContext.jsx'
import { isYouTubeId } from '../lib/api.js'
import { YtPlayer, YT_STATE } from '../lib/ytPlayer.js'
import { fetchPlaybackState, recordPlaySession, savePlaybackState } from '../lib/db.js'
import { youtubeRequest } from '../lib/api.js'
import { pickRecommendations, recommendationErrorMessage } from '../lib/recommendations.js'

/**
 * The one music player - now backed by the official YouTube IFrame Player API.
 *
 * Every track goes through this context: queue, next/previous, seeking,
 * repeat mode, failure handling and "log a play once per track start".
 * The public API (and therefore every component in the app) is unchanged from
 * the <audio> version; only the engine behind it swapped.
 *
 * The YouTube player lives in ONE panel rendered by Layout but shown ONLY with
 * the Expanded Now Playing screen. Minimising pauses playback first, so no
 * video ever plays from a hidden player (YouTube Developer Policies). The
 * iframe stays >=200x200, unobstructed, and is never rebuilt.
 */
const PlayerContext = createContext(null)

const REPEAT_KEY = 'melody:repeat'
/* off -> all -> one, in the order the button cycles through them */
const REPEAT_MODES = ['off', 'all', 'one']
const SHUFFLE_KEY = 'melody:shuffle'

/** How often the panel position is mirrored into React while playing. */
const TICK_MS = 250

/* A play is only counted after the listener has actually heard this much of
   the track. The backend enforces the same floor - this is just the client
   timer. Configurable via VITE_MIN_PLAY_MS (milliseconds, default 3000). */
const MIN_PLAY_MS = Math.max(0, Number(import.meta.env.VITE_MIN_PLAY_MS) || 3000)
const SEEN_LIMIT = 60

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

/**
 * User-facing text for an IFrame onError code, so a failure says what
 * actually happened instead of one blanket "may be unavailable" - and the
 * code is quoted back for a bug report. Never worded as a workaround: when
 * YouTube refuses a video we say so plainly and the queue moves on.
 */
function videoErrorMessage(code, title) {
  const name = title || 'This track'
  const at = ` (YouTube error ${code})`
  switch (code) {
    case 2:
      return `“${name}” can’t be played - YouTube no longer accepts this video id${at}. Pick another result.`
    case 5:
      return `“${name}” couldn’t start in the YouTube player${at}. Pick another result.`
    case 100:
      return `“${name}” is no longer on YouTube - it may have been removed or made private${at}. Pick another result.`
    case 101:
    case 150:
      return `“${name}” can’t be embedded by its owner, so it can’t be played here${at}. Pick another result.`
    default:
      return `“${name}” can’t be played right now. It may be unavailable.${code ? at : ''}`
  }
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

function readShuffle() {
  try {
    return localStorage.getItem(SHUFFLE_KEY) === 'on'
  } catch {
    return false
  }
}

export function PlayerProvider({ children }) {
  const toast = useToast()
  const { session } = useAuth()

  /* The panel host div (rendered below) - the IFrame API owns what goes in it. */
  const hostRef = useRef(null)
  /* The OUTER panel. Its geometry is restyled when the expanded screen opens,
     but the node itself is never moved or recreated: reparenting an <iframe>
     reloads it, which would restart the song. */
  const panelRef = useRef(null)
  const ytRef = useRef(null)
  const pendingRef = useRef(null) // video to start as soon as the player exists

  const [queue, setQueue] = useState([])
  const [index, setIndex] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [repeat, setRepeat] = useState(readRepeat)
  const [shuffle, setShuffle] = useState(readShuffle)
  /* True once a playable (YouTube) video has been requested: it is what keeps
     the panel on screen, so a queue of unplayable legacy rows never shows an
     empty player. */
  const [hasVideo, setHasVideo] = useState(false)
  /* UI only - never touches the player. The compact bar and the expanded Now
     Playing screen are two views of ONE playback state. */
  const [expanded, setExpanded] = useState(false)
  /* Playback context. Playlist mode uses ONLY the active playlist as its
     queue; recommendation mode uses up-next + genre-based refills. */
  const [playbackMode, setPlaybackMode] = useState('recommendations')
  const [activePlaylist, setActivePlaylist] = useState(null)
  /* Dedicated recommendation queue - kept separate from playback history. */
  const [upNext, setUpNext] = useState([])
  /* Last recommendation failure (quota / rate limit / upstream), if any. */
  const [recommendationError, setRecommendationError] = useState(null)
  /* Ids already played or suggested, used to avoid repeats. */
  const [seenIds, setSeenIds] = useState([])

  const queueRef = useRef(queue)
  const indexRef = useRef(index)
  const repeatRef = useRef(repeat)
  const shuffleRef = useRef(shuffle)
  const playbackModeRef = useRef(playbackMode)
  const activePlaylistRef = useRef(activePlaylist)
  /* A stable shuffled order over the CURRENT queue: one pass plays every song
     before any of them repeats. Rebuilt only when the queue or seed changes. */
  const shuffleOrderRef = useRef([])
  const shuffleCursorRef = useRef(-1)
  const shuffleQueueRef = useRef(null)
  /* One guard per track completion: YouTube can emit ENDED more than once (or
     a stale event can arrive after a track change). The key is the playback
     session + video id, so one completion can advance at most once. */
  const endedGuardRef = useRef({ key: '', at: 0 })
  /* One in-flight recommendation refill, shared by Next, auto-advance and the
     UI. Prevents a search per ended event / per re-render. */
  const refillRef = useRef(null)
  /* Honour a 429/503 Retry-After instead of firing another search per render. */
  const recRetryUntilRef = useRef(0)
  const durationRef = useRef(duration)
  const timeRef = useRef(time)
  const playingRef = useRef(playing)
  const errorHandledRef = useRef(false)
  const failStreakRef = useRef(0)
  const legacyWarnedRef = useRef(false)
  const sessionRef = useRef(session)
  const toastRef = useRef(toast)
  const upNextRef = useRef(upNext)
  const seenRef = useRef(seenIds)
  /* One id per playback session: repeat-one and manual restarts reuse it,
     a genuine new track selection generates a new one. */
  const sessionIdRef = useRef('')
  const recordedRef = useRef(false)
  const playTimerRef = useRef(0)
  /* Playback persistence: last signed-in user (survives logout), an in-flight
     restore flag, and a seek queued until the restored video is ready. */
  const lastUserIdRef = useRef(null)
  const restoringRef = useRef(false)
  const restoreGenerationRef = useRef(0)
  const pendingSeekRef = useRef(0)
  const saveTimerRef = useRef(0)

  queueRef.current = queue
  indexRef.current = index
  repeatRef.current = repeat
  shuffleRef.current = shuffle
  playbackModeRef.current = playbackMode
  activePlaylistRef.current = activePlaylist
  durationRef.current = duration
  timeRef.current = time
  playingRef.current = playing
  sessionRef.current = session
  toastRef.current = toast
  upNextRef.current = upNext
  seenRef.current = seenIds

  const current = index >= 0 && index < queue.length ? queue[index] : null

  const newSessionId = () =>
    (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`)

  const clearRecommendationError = useCallback(() => setRecommendationError(null), [])

  /** Remember ids we have played or suggested so they are not repeated. */
  const markSeen = useCallback((ids) => {
    const nextSeen = [...new Set([...(seenRef.current || []), ...ids.filter(Boolean)])].slice(-SEEN_LIMIT)
    seenRef.current = nextSeen
    setSeenIds(nextSeen)
  }, [])

  /** Recommendations become the dedicated "up next" queue.ids are marked as
      seen only when they actually play, so this does not retrigger the UI's
      recommendation fetch. */
  const setRecommendationQueue = useCallback((tracks) => {
    const list = (tracks || []).filter((t) => t && t.external_id)
    upNextRef.current = list
    setUpNext(list)
  }, [])

  /* ------------------------------- transport ------------------------------- */

  /**
   * YouTube requires an autoplay/auto-advanced video to be more than half
   * visible when playback starts. In the compact view the panel is fixed and
   * always visible; in the expanded view the document scrolls, so bring the
   * video slot back into view first.
   */
  const ensurePlayerVisible = useCallback(() => {
    if (typeof document === 'undefined') return
    const target = document.querySelector('.np-video-slot') || panelRef.current
    if (!target || typeof target.getBoundingClientRect !== 'function') return
    const r = target.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return
    const visibleW = Math.max(0, Math.min(r.right, window.innerWidth) - Math.max(r.left, 0))
    const visibleH = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0))
    if ((visibleW * visibleH) / (r.width * r.height) < 0.5) {
      target.scrollIntoView({ block: 'center' })
    }
  }, [])

  /** Ask the player for a video now, or remember it until the player exists. */
  const startVideo = useCallback((videoId, autoplay) => {
    if (autoplay) ensurePlayerVisible()
    pendingRef.current = { videoId, autoplay }
    const yt = ytRef.current
    if (yt) yt.load(videoId, autoplay)
  }, [ensurePlayerVisible])

  /** Apply a saved playback position once the restored video can be seeked. */
  const applyPendingSeek = useCallback(() => {
    const position = pendingSeekRef.current
    if (!position || !ytRef.current) return
    ytRef.current.seek(position)
    pendingSeekRef.current = 0
  }, [])

  /** Everything needed to recreate this session, read from refs so it stays
      accurate even when called from an unmount/logout effect. */
  const playerSnapshot = useCallback(
    () => ({
      current: queueRef.current[indexRef.current] || null,
      queue: queueRef.current,
      index: indexRef.current,
      time: ytRef.current && typeof ytRef.current.getTime === 'function'
        ? ytRef.current.getTime()
        : timeRef.current,
      repeat: repeatRef.current,
      shuffle: shuffleRef.current,
      playbackMode: playbackModeRef.current,
      activePlaylist: activePlaylistRef.current,
    }),
    []
  )

  const persistPlayback = useCallback(
    async (userId, snapshot = playerSnapshot()) => {
      if (!userId || !snapshot || !snapshot.current || !snapshot.current.external_id) return
      try {
        await savePlaybackState(userId, snapshot)
      } catch (err) {
        if (import.meta.env.DEV) console.warn('[melody] could not save playback state', err?.message)
      }
    },
    [playerSnapshot]
  )

  /** Restore a saved session cued (never autoplay) so browser autoplay rules
      are respected. The play button stays available and no new play record is
      created for the restored session. */
  const restorePlayback = useCallback(
    async (userId, generation) => {
      restoringRef.current = true
      try {
        const saved = await fetchPlaybackState()
        if (!saved || generation !== restoreGenerationRef.current) return
        const restoredQueue = normalizeQueue(saved.queue)
        const savedTrack = saved.current_track || null
        if (!restoredQueue.length || !savedTrack || !savedTrack.external_id) return

        let index = Number(saved.track_index)
        if (!Number.isFinite(index) || index < 0 || index >= restoredQueue.length) {
          index = restoredQueue.findIndex((t) => t.external_id === savedTrack.external_id)
        }
        if (index < 0) return

        setQueue(restoredQueue)
        queueRef.current = restoredQueue
        setIndex(index)
        indexRef.current = index
        setTime(0)
        timeRef.current = 0
        setDuration(Number(restoredQueue[index].duration) || 0)
        setPlaying(false)
        setLoading(false)
        const savedRepeat = ['off', 'all', 'one'].includes(saved.repeat_mode) ? saved.repeat_mode : 'off'
        const savedShuffle = Boolean(saved.shuffle)
        setRepeat(savedRepeat)
        setShuffle(savedShuffle)
        repeatRef.current = savedRepeat
        shuffleRef.current = savedShuffle
        try {
          localStorage.setItem(REPEAT_KEY, savedRepeat)
          localStorage.setItem(SHUFFLE_KEY, savedShuffle ? 'on' : 'off')
        } catch {
          /* private mode */
        }
        setPlaybackMode(saved.playback_mode === 'playlist' ? 'playlist' : 'recommendations')
        setActivePlaylist(saved.active_playlist || null)
        setUpNext([])
        upNextRef.current = []
        seenRef.current = []
        setSeenIds([])
        errorHandledRef.current = false
        failStreakRef.current = 0
        recordedRef.current = false
        clearTimeout(playTimerRef.current)

        pendingSeekRef.current = Math.max(0, Number(saved.position_seconds) || 0)
        setHasVideo(true)
        startVideo(restoredQueue[index].external_id, false)
      } catch (err) {
        if (import.meta.env.DEV) console.warn('[melody] could not restore playback state', err?.message)
      } finally {
        if (generation === restoreGenerationRef.current) restoringRef.current = false
      }
    },
    [startVideo]
  )

  const tryPlay = useCallback(() => {
    ytRef.current?.play()
  }, [])

  /* Pure view switch: the SAME iframe is relocated into the expanded video
     slot by the layout effect below. No pause, no reload, no new YT.Player. */
  const openPlayer = useCallback(() => setExpanded(true), [])
  const closePlayer = useCallback(() => setExpanded(false), [])

  /**
   * A track that cannot be played: say so, then move on (never loop forever).
   * `message` overrides the default wording - used for rows saved before the
   * migration, whose Audius ids no player can resolve any more.
   */
  const fail = useCallback((message) => {
    if (errorHandledRef.current) return
    errorHandledRef.current = true
    setLoading(false)
    setPlaying(false)

    const song = queueRef.current[indexRef.current]
    toastRef.current(
      message ||
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

  /** Record this session once, after a minimum listened time. Scheduled both
     at load time and on PLAYING, because switching tracks while already
     playing does not always emit a second PLAYING event. */
  const schedulePlayRecord = useCallback((song, sessionId) => {
    if (!song || !sessionRef.current || !isYouTubeId(song.external_id) || recordedRef.current) return
    clearTimeout(playTimerRef.current)
    playTimerRef.current = setTimeout(() => {
      const currentSong = queueRef.current[indexRef.current]
      if (recordedRef.current || !currentSong || currentSong.external_id !== song.external_id) return
      if (ytRef.current && ytRef.current.getState && ytRef.current.getState() !== YT_STATE.PLAYING) return
      recordedRef.current = true
      if (import.meta.env.DEV) {
        console.debug('[melody] listening threshold reached, submitting play', {
          sessionId,
          videoId: song.external_id,
          listenedMs: MIN_PLAY_MS,
        })
      }
      recordPlaySession(currentSong, sessionId, MIN_PLAY_MS)
        .then((result) => {
          if (import.meta.env.DEV) {
            console.debug('[melody] play record result', {
              sessionId,
              videoId: song.external_id,
              recorded: result && result.recorded,
              duplicate: Boolean(result && result.duplicate),
            })
          }
          /* Only a confirmed INSERT may change the displayed counter. */
          if (result && result.recorded === true) {
            window.dispatchEvent(new Event('melody:plays-changed'))
          }
        })
        .catch((err) => {
          if (import.meta.env.DEV) {
            console.warn('[melody] play record FAILED', {
              sessionId,
              videoId: song.external_id,
              error: (err && err.message) || String(err),
            })
          }
        })
    }, MIN_PLAY_MS)
  }, [])

  /** A full shuffled permutation of the queue, with the current song first.
      cursor 0 means "currently playing order[0]". */
  const rebuildShuffleOrder = useCallback((q, currentIndex) => {
    const order = q.map((_, i) => i)
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      const tmp = order[i]
      order[i] = order[j]
      order[j] = tmp
    }
    const at = order.indexOf(currentIndex)
    if (at > 0) {
      order.splice(at, 1)
      order.unshift(currentIndex)
    }
    shuffleOrderRef.current = order
    shuffleCursorRef.current = 0
    shuffleQueueRef.current = q
  }, [])

  /** Step through the SAME shuffled order; reshuffle only after a full pass. */
  const shuffledStep = useCallback(
    (q, currentIndex, direction) => {
      const order = shuffleOrderRef.current
      const valid =
        shuffleQueueRef.current === q &&
        order.length === q.length &&
        order[shuffleCursorRef.current] === currentIndex
      if (!valid) rebuildShuffleOrder(q, currentIndex)
      let cursor = shuffleCursorRef.current + direction
      if (cursor >= shuffleOrderRef.current.length) {
        rebuildShuffleOrder(q, currentIndex)
        cursor = Math.min(1, shuffleOrderRef.current.length - 1)
      } else if (cursor < 0) {
        rebuildShuffleOrder(q, currentIndex)
        cursor = shuffleOrderRef.current.length - 1
      }
      shuffleCursorRef.current = cursor
      return shuffleOrderRef.current[cursor]
    },
    [rebuildShuffleOrder]
  )

  const load = useCallback(
    (i, autoplay, options = {}) => {
      const q = queueRef.current
      if (i < 0 || i >= q.length) return
      const song = q[i]
      /* Direct selections re-anchor shuffle; transport steps pass
         preserveShuffle so the same shuffled order survives Next/Previous. */
      if (!options.preserveShuffle) rebuildShuffleOrder(q, i)

      errorHandledRef.current = false
      indexRef.current = i
      setIndex(i)
      setTime(0)
      setDuration(Number(song.duration) || 0)
      /* Every new track selection is a new listening session. Automatic
         restarts (repeat-one / prev-restart) do NOT call load, so they keep
         the same id and cannot create a second play record. */
      sessionIdRef.current = newSessionId()
      recordedRef.current = false
      if (import.meta.env.DEV) {
        console.debug('[melody] playback session created', {
          sessionId: sessionIdRef.current,
          videoId: song.external_id,
        })
      }
      clearTimeout(playTimerRef.current)
      markSeen([song.external_id])

      /* Rows saved before the migration carry Audius ids: no video id, no
         player. Warn once per queue and skip to the next playable track.
         The panel is deliberately NOT hidden here: it only ever hides when a
         video is truly gone (logout), and blanking it for the 600ms before the
         skip would take a live, playing iframe through display:none and back -
         the exact visibility switch that can knock an HTML5 player over. */
      if (!isYouTubeId(song.external_id)) {
        pendingRef.current = null
        setLoading(false)
        setPlaying(false)
        if (!legacyWarnedRef.current) {
          legacyWarnedRef.current = true
          toastRef.current(
            'Some songs here were saved from Audius and can’t be played any more.',
            true
          )
        }
        failStreakRef.current += 1
        const len = q.length
        if (len > 1 && failStreakRef.current < len) {
          const idx = i
          setTimeout(() => {
            if (indexRef.current === idx && queueRef.current.length > 1) {
              loadRef.current(idx + 1 < queueRef.current.length ? idx + 1 : 0, true)
            }
          }, 600)
        }
        return
      }

      setHasVideo(true)
      if (autoplay) setLoading(true)
      else setLoading(false)
      startVideo(song.external_id, autoplay)
      if (autoplay) schedulePlayRecord(song, sessionIdRef.current)
    },
    [startVideo, markSeen, schedulePlayRecord, rebuildShuffleOrder]
  )

  const loadRef = useRef(load)
  loadRef.current = load

  /**
   * Start a finite queue. Passing a playlist source establishes Playlist Mode;
   * every other caller (search, history, favourites, a direct link) starts in
   * Recommendation Mode. The two modes never share a queue.
   */
  const playQueue = useCallback(
    (items, startIndex = 0, source = null) => {
      const normalized = normalizeQueue(items)
      if (!normalized.length) return
      const fromPlaylist = Boolean(source && source.type === 'playlist' && source.id)
      setPlaybackMode(fromPlaylist ? 'playlist' : 'recommendations')
      setActivePlaylist(
        fromPlaylist
          ? { id: String(source.id), name: String(source.name || 'Playlist') }
          : null
      )
      /* Clear any recommendation leftovers so songs from another context can
         never leak into the new queue. */
      upNextRef.current = []
      setUpNext([])
      setRecommendationError(null)
      queueRef.current = normalized
      setQueue(normalized)
      failStreakRef.current = 0
      legacyWarnedRef.current = false
      const i = Math.max(0, Math.min(Number(startIndex) || 0, normalized.length - 1))
      load(i, true)
    },
    [load]
  )

  /** Replace the queue/context for the track that is ALREADY loaded. Used by
      Jump Back In so a live song can adopt its playlist queue without restarting. */
  const adoptQueue = useCallback(
    (items, startIndex = 0, source = null) => {
      const normalized = normalizeQueue(items)
      if (!normalized.length) return
      const fromPlaylist = Boolean(source && source.type === 'playlist' && source.id)
      setPlaybackMode(fromPlaylist ? 'playlist' : 'recommendations')
      setActivePlaylist(
        fromPlaylist ? { id: String(source.id), name: String(source.name || 'Playlist') } : null
      )
      upNextRef.current = []
      setUpNext([])
      const i = Math.max(0, Math.min(Number(startIndex) || 0, normalized.length - 1))
      queueRef.current = normalized
      indexRef.current = i
      setQueue(normalized)
      setIndex(i)
    },
    []
  )

  /**
   * Fetch another similar set ONLY when the up-next queue is empty. Concurrent
   * callers (auto-advance, manual Next, the visible recommendations list) share
   * one in-flight request, so switching tracks or ending a song never triggers
   * a search just because the UI re-rendered.
   */
  const refillRecommendations = useCallback(
    (base) => {
      if (refillRef.current) return refillRef.current
      if (Date.now() < recRetryUntilRef.current) return Promise.resolve([])
      const song = base || queueRef.current[indexRef.current]
      if (!song) return Promise.resolve([])
      const task = (async () => {
        try {
          const res = await youtubeRequest({
            action: 'recommendations',
            id: song.external_id,
            title: song.title,
            artist: song.artist,
            genre: song.genre,
            limit: 14,
          })
          const list = pickRecommendations(res.tracks, song, seenRef.current, 8)
          /* Never clear a previously valid queue on a failed/empty refresh. */
          if (list.length) setRecommendationQueue(list)
          setRecommendationError(null)
          return list
        } catch (err) {
          const retryAfter = Number(err && err.retryAfter)
          if (Number.isFinite(retryAfter) && retryAfter > 0) {
            recRetryUntilRef.current = Date.now() + retryAfter * 1000
          }
          setRecommendationError({
            message: recommendationErrorMessage(err),
            retryAfter,
            retryAt: recRetryUntilRef.current,
          })
          return []
        }
      })()
      refillRef.current = task
      task.finally(() => {
        if (refillRef.current === task) refillRef.current = null
      })
      return task
    },
    [setRecommendationQueue]
  )

  /**
   * Advance to a DIFFERENT track. Shared by the Next button and automatic
   * end-of-song handling so both use exactly the same queue / recommendation
   * logic. No search is made while up-next or the queue still has a candidate.
   */
  const next = useCallback((options = {}) => {
    const fromEnded = Boolean(options && options.fromEnded)
    const q = queueRef.current
    const idx = indexRef.current
    const stop = () => {
      if (fromEnded) { setPlaying(false); setLoading(false) }
    }
    if (!q.length || idx < 0) {
      stop()
      return
    }

    /* PLAYLIST MODE: advance only inside the active playlist queue. No up-next
       recommendations, no history filtering and no search - the saved order
       is authoritative (shuffle randomises that same queue). */
    if (playbackModeRef.current === 'playlist') {
      let at = -1
      if (shuffleRef.current) {
        at = shuffledStep(q, idx, 1) // every song once, then a new shuffled pass
      } else if (idx + 1 < q.length) {
        at = idx + 1
      } else if (q.length > 1) {
        at = 0 // a playlist loops to its first song when the last one ends
      }
      if (at >= 0) load(at, true, { preserveShuffle: true })
      else stop()
      return
    }

    const playingId = q[idx].external_id || null
    const seen = seenRef.current || []

    const pick = (list, ignoreSeen = false) => {
      const usable = (list || []).filter(
        (t) => t && t.external_id && t.external_id !== playingId &&
          (ignoreSeen || !seen.includes(t.external_id))
      )
      if (!usable.length) return null
      /* Shuffle picks any available track, never the current one. */
      const track = shuffleRef.current
        ? usable[Math.floor(Math.random() * usable.length)]
        : usable[0]
      return { track, rest: usable.filter((t) => t.external_id !== track.external_id) }
    }

    const playFrom = (chosen, rest, sourceQueue) => {
      upNextRef.current = rest
      setUpNext(rest)
      if (sourceQueue) {
        const at = sourceQueue.findIndex((t) => t.external_id === chosen.external_id)
        if (at >= 0) {
          load(at, true)
          return
        }
      }
      const nq = [...queueRef.current, chosen]
      queueRef.current = nq
      setQueue(nq)
      load(nq.length - 1, true)
    }

    /* 1) recommendation queue - zero API requests. */
    const fromUpNext = pick(upNextRef.current)
    if (fromUpNext) { playFrom(fromUpNext.track, fromUpNext.rest, null); return }

    /* 2) the rest of the real playback queue. */
    const fromQueue = pick(q.slice(idx + 1))
    if (fromQueue) { playFrom(fromQueue.track, fromQueue.rest, q); return }

    /* 3) Repeat All wraps the real queue (history is irrelevant here). */
    if (repeatRef.current === 'all') {
      const wrapped = pick(q.slice(0, idx), true)
      if (wrapped) { playFrom(wrapped.track, wrapped.rest, q); return }
    }

    /* 4) genuinely empty: ONE shared refill, then play from it. */
    refillRecommendations(q[idx]).then((list) => {
      if (queueRef.current !== q || indexRef.current !== idx) return
      const fresh = pick(list)
      if (fresh) { playFrom(fresh.track, fresh.rest, null); return }
      if (repeatRef.current === 'all') {
        const wrapped = pick(queueRef.current.slice(0, indexRef.current), true)
        if (wrapped) { playFrom(wrapped.track, wrapped.rest, queueRef.current); return }
      }
      stop()
    })
  }, [load, refillRecommendations, shuffledStep])

  const prev = useCallback(() => {
    const q = queueRef.current
    if (!q.length) return
    /* Playlist mode always moves to the previous saved song (or wraps), never
       to a recommendation from another playlist. */
    if (playbackModeRef.current === 'playlist') {
      const at = shuffleRef.current
        ? shuffledStep(q, indexRef.current, -1)
        : (indexRef.current > 0 ? indexRef.current - 1 : q.length - 1)
      load(at, true, { preserveShuffle: true })
      return
    }
    const yt = ytRef.current
    // Same rule as the old <audio> version: a few seconds in, "previous"
    // restarts the song; otherwise it goes to the track before this one.
    if (yt && yt.getTime() > 3) {
      yt.seek(0)
      return
    }
    load(indexRef.current > 0 ? indexRef.current - 1 : q.length - 1, true)
  }, [load, shuffledStep])

  const toggle = useCallback(() => {
    const q = queueRef.current
    if (!q.length) return
    const yt = ytRef.current
    if (!yt || indexRef.current < 0) {
      load(indexRef.current >= 0 ? indexRef.current : 0, true)
      return
    }
    const state = yt.getState()
    const active =
      playingRef.current || state === YT_STATE.PLAYING || state === YT_STATE.BUFFERING
    if (active) {
      yt.pause()
    } else {
      setLoading(true)
      yt.play()
    }
  }, [load])

  const seekPercent = useCallback((percent) => {
    const yt = ytRef.current
    if (!yt) return
    const total = yt.getDuration() || durationRef.current
    if (!total || !isFinite(total)) return
    yt.seek((Number(percent) / 100) * total)
  }, [])

  /**
   * Playing a recommendation is an explicit switch back to Recommendation
   * Mode: it starts a fresh queue for that song instead of appending it to an
   * active playlist (which would mix the two sources).
   */
  const enqueueAndPlay = useCallback(
    (track) => {
      const normalized = normalizeQueue([track])
      if (!normalized.length) return
      setPlaybackMode('recommendations')
      setActivePlaylist(null)
      upNextRef.current = []
      setUpNext([])
      setRecommendationError(null)
      queueRef.current = normalized
      failStreakRef.current = 0
      legacyWarnedRef.current = false
      setQueue(normalized)
      load(0, true)
    },
    [load]
  )

  /** Jump to a row of the active queue without changing its source. */
  const playAt = useCallback((index) => load(index, true), [load])

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

  /** Shuffle only changes WHICH queued track is picked next; it never touches
      the player, the current position or the playback state. */
  const toggleShuffle = useCallback(() => {
    const on = !shuffleRef.current
    shuffleRef.current = on
    setShuffle(on)
    if (on) rebuildShuffleOrder(queueRef.current, indexRef.current)
    else {
      shuffleOrderRef.current = []
      shuffleCursorRef.current = -1
      shuffleQueueRef.current = null
    }
    try {
      localStorage.setItem(SHUFFLE_KEY, on ? 'on' : 'off')
    } catch {
      /* private mode etc. */
    }
  }, [rebuildShuffleOrder])

  /* ------------------------- YouTube player events ------------------------ */

  /**
   * YouTube's ENDED state - the single place automatic advancement happens.
   * `endedVideoId` comes from the event's player, so a late event for a song
   * we already left cannot advance the new one. The per-session guard makes
   * duplicate ENDED events a no-op.
   */
  const handleEnded = useCallback((endedVideoId) => {
    const song = queueRef.current[indexRef.current]
    const id = endedVideoId || (song && song.external_id) || ''
    const guard = `${sessionIdRef.current}:${id}`
    const now = Date.now()
    /* Key catches a repeated event for the same completion; the short window
       also catches a burst of events arriving in the same tick AFTER the next
       track has already been loaded (the key would then be a new one). It only
       coalesces duplicate ENDED signals - playback itself is never delayed. */
    if (endedGuardRef.current.key === guard || now - endedGuardRef.current.at < 1000) return
    endedGuardRef.current = { key: guard, at: now }

    const mode = repeatRef.current
    if (!song) return

    // Repeat One: restart the same video. Same session id + same guard key,
    // so this can never create a second listening-history record.
    if (mode === 'one') {
      if (isYouTubeId(song.external_id)) {
        setTime(0)
        setDuration(Number(song.duration) || 0)
        startVideo(song.external_id, true)
      }
      return
    }

    /* Normal AND Repeat All advance through the exact same Next logic. There
       is deliberately no "seek(0)" fallback here: finishing the last queued
       song must load the next recommendation, not restart the old one. */
    nextRef.current({ fromEnded: true })
  }, [startVideo])

  const handleState = useCallback(
    (state, videoId) => {
      if (state === YT_STATE.PLAYING) {
        applyPendingSeek()
        setPlaying(true)
        setLoading(false)
        failStreakRef.current = 0

        const song = queueRef.current[indexRef.current]
        if (import.meta.env.DEV) {
          console.debug('[melody] playback started', {
            videoId: song ? song.external_id : null,
            sessionId: sessionIdRef.current,
          })
        }
        // One history row per qualifying session, after a minimum listen time.
        // The backend enforces the same rule and the session id is unique, so
        // repeated PLAYING events / repeat-one restarts cannot add rows.
        if (song) schedulePlayRecord(song, sessionIdRef.current)
        return
      }
      if (state === YT_STATE.PAUSED) {
        setPlaying(false)
        setLoading(false)
        return
      }
      if (state === YT_STATE.BUFFERING) {
        setLoading(true)
        return
      }
      if (state === YT_STATE.ENDED) {
        /* A stale ENDED from the previous video may arrive right after a track
           change; it must not be treated as the new song finishing. */
        const song = queueRef.current[indexRef.current]
        if (videoId && song && song.external_id && videoId !== song.external_id) return
        handleEnded(videoId)
        return
      }
      if (state === YT_STATE.CUED) applyPendingSeek()
      // UNSTARTED / CUED: nothing is moving yet.
      setPlaying(false)
      setLoading(false)
    },
    [handleEnded, schedulePlayRecord, applyPendingSeek]
  )

  /* Video-level failure: deleted, private, restricted or not embeddable.
     The player reports WHICH video failed as well as why - an event that
     belongs to a track we have already moved past is dropped, so a failure
     can never be blamed on (or stop) the track that is selected now. */
  const handleVideoError = useCallback(
    (err) => {
      const code = typeof err === 'number' ? err : err ? Number(err.code) : 0
      const failedId = (err && err.videoId) || null
      const song = queueRef.current[indexRef.current]
      /* TEMPORARY diagnostic: exactly what YouTube reported, so a failure on
         any machine can be identified without guessing - the code, the id the
         player actually tried to play, and the id we asked for. Contains no
         credentials: only an error code and a public video id. */
      if (import.meta.env.DEV) {
        console.warn('[melody] YouTube onError', {
          code: Number.isFinite(code) ? code : 0,
          videoId: failedId,
          requested: song ? song.external_id : null,
          title: song ? song.title : null,
        })
      }
      if (failedId && song && song.external_id && failedId !== song.external_id) return
      fail(videoErrorMessage(Number.isFinite(code) ? code : 0, song ? song.title : ''))
    },
    [fail]
  )

  /* The player itself could not start (offline, blocked script, timeout). */
  const handlePlayerError = useCallback(
    (err) => {
      fail(err && err.message ? err.message : 'Could not start the YouTube player.')
    },
    [fail]
  )

  /* --------------------- create the player once it shows ------------------ */
  // Runs only after the panel is on screen (hasVideo flips in the same commit
  // that makes it visible), which is what YouTube's autoplay rules ask for.
  useEffect(() => {
    if (!hasVideo || ytRef.current || !hostRef.current) return undefined
    const yt = new YtPlayer(hostRef.current, {
      onReady: applyPendingSeek,
      onState: handleState,
      onVideoError: handleVideoError,
      onPlayerError: handlePlayerError,
    })
    ytRef.current = yt
    /* No in-app volume control: the listener uses their device volume. */
    yt.setVolume(1)
    const pending = pendingRef.current
    if (pending) yt.load(pending.videoId, pending.autoplay)
    return undefined
  }, [hasVideo, handleState, handleVideoError, handlePlayerError, applyPendingSeek])

  /* Anything pinned above the player bar (the toast) must stay clear of the
     video panel: style.css moves it up while this class is on <body>. */
  useEffect(() => {
    document.body.classList.toggle('has-yt-panel', hasVideo)
    return () => document.body.classList.remove('has-yt-panel')
  }, [hasVideo])

  /* Body class drives the expanded overlay's stacking rules. */
  useLayoutEffect(() => {
    document.body.classList.toggle('np-open', expanded)
    return () => document.body.classList.remove('np-open')
  }, [expanded])

  /* Put the SAME player into the expanded screen's video slot. Only geometry
     is written to the existing node - no React re-parent, no new YT.Player -
     so switching views preserves the exact playback position. */
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return undefined
    if (!expanded) {
      panel.style.transform = ''
      panel.style.willChange = ''
      panel.style.left = ''
      panel.style.top = ''
      panel.style.width = ''
      panel.style.height = ''
      return undefined
    }
    /* Keep the fixed iframe glued to its in-flow slot while the whole view
       scrolls normally. Reading the rect and writing a compositor-only
       transform inside rAF avoids the layout thrash / touch-scroll lag that
       caused the old left/top-on-scroll jitter. */
    const slot = document.querySelector('.np-video-slot')
    if (!slot) return undefined
    const first = slot.getBoundingClientRect()
    panel.style.left = '0px'
    panel.style.top = '0px'
    panel.style.width = `${Math.round(first.width)}px`
    panel.style.height = `${Math.round(first.height)}px`
    panel.style.willChange = 'transform'

    let frame = 0
    const follow = () => {
      frame = 0
      const r = slot.getBoundingClientRect()
      /* Resize with the slot on viewport changes; transform stays compositor
         only, so scrolling never triggers layout. */
      const w = `${Math.round(r.width)}px`
      const h = `${Math.round(r.height)}px`
      if (panel.style.width !== w) panel.style.width = w
      if (panel.style.height !== h) panel.style.height = h
      panel.style.transform = `translate3d(${Math.round(r.left)}px, ${Math.round(r.top)}px, 0)`
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(follow)
    }
    follow()

    /* The document/window now owns scrolling, so follow window scroll. */
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null
    if (ro) ro.observe(slot)

    return () => {
      if (frame) cancelAnimationFrame(frame)
      if (ro) ro.disconnect()
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      panel.style.transform = ''
      panel.style.willChange = ''
    }
  }, [expanded])

  /* Position/duration mirror: the IFrame API has no timeupdate event. */
  useEffect(() => {
    if (!hasVideo) return undefined
    const id = setInterval(() => {
      const yt = ytRef.current
      if (!yt) return
      const total = yt.getDuration()
      if (total > 0 && total !== durationRef.current) {
        durationRef.current = total
        setDuration(total)
      }
      setTime(yt.getTime())
    }, TICK_MS)
    return () => clearInterval(id)
  }, [hasVideo])

  /* The panel and its player outlive every route: tear them down for good. */
  useEffect(
    () => () => {
      clearTimeout(playTimerRef.current)
      ytRef.current?.destroy()
      ytRef.current = null
    },
    []
  )

  const nextRef = useRef(next)
  nextRef.current = next

  /* ------------------- per-user persistence + session ------------------- */
  /* Save after any meaningful player change. Debounced so the 250ms position
     tick does not write on every frame; a logout saves synchronously below. */
  useEffect(() => {
    const userId = session?.user?.id ?? null
    if (!userId || restoringRef.current || pendingSeekRef.current > 0) return undefined
    clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => persistPlayback(userId), 800)
    return () => clearTimeout(saveTimerRef.current)
  }, [
    session?.user?.id,
    current,
    queue,
    index,
    playing,
    repeat,
    shuffle,
    playbackMode,
    activePlaylist,
    persistPlayback,
  ])

  /* Periodic checkpoint for playback position. The debounced effect above
     deliberately does NOT depend on `time` (the 250ms tick would cancel it). */
  useEffect(() => {
    const userId = session?.user?.id ?? null
    if (!userId || !current || restoringRef.current) return undefined
    const id = setInterval(() => {
      if (!restoringRef.current && pendingSeekRef.current <= 0) persistPlayback(userId)
    }, 5000)
    return () => clearInterval(id)
  }, [session?.user?.id, current, persistPlayback])

  /* Session transitions: save the outgoing user's state BEFORE touching the
     player, then restore the incoming user (or silence on logout). Nothing is
     deleted from the database on logout. */
  useEffect(() => {
    const userId = session?.user?.id ?? null
    const previous = lastUserIdRef.current
    const generation = ++restoreGenerationRef.current
    if (previous && previous !== userId) void persistPlayback(previous)

    if (!userId) {
      errorHandledRef.current = true // stopping is not a playback failure
      clearTimeout(playTimerRef.current)
      clearTimeout(saveTimerRef.current)
      pendingRef.current = null
      ytRef.current?.stop()
      queueRef.current = []
      setQueue([])
      indexRef.current = -1
      setIndex(-1)
      setPlaying(false)
      setLoading(false)
      setTime(0)
      timeRef.current = 0
      setDuration(0)
      setHasVideo(false)
      setExpanded(false)
      upNextRef.current = []
      setUpNext([])
      setPlaybackMode('recommendations')
      setActivePlaylist(null)
      seenRef.current = []
      setSeenIds([])
      recordedRef.current = false
      pendingSeekRef.current = 0
      failStreakRef.current = 0
      legacyWarnedRef.current = false
      lastUserIdRef.current = null
      return
    }

    lastUserIdRef.current = userId
    void restorePlayback(userId, generation)
  }, [session?.user?.id, persistPlayback, restorePlayback])

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
      repeat,
      shuffle,
      playbackMode,
      activePlaylist,
      hasVideo,
      hasTrack: Boolean(current),
      expanded,
      openPlayer,
      closePlayer,
      /* The single panel is rendered by Layout and stays mounted for the whole
         session. Sharing the refs lets the ONE YT.Player live in that node. */
      hostRef,
      panelRef,
      playQueue,
      adoptQueue,
      playAt,
      enqueueAndPlay,
      setRecommendationQueue,
      refillRecommendations,
      clearRecommendationError,
      upNext,
      recommendationError,
      seenIds,
      toggle,
      next,
      prev,
      seekPercent,
      cycleRepeat,
      toggleShuffle,
    }),
    [queue, index, current, playing, loading, time, duration, repeat, shuffle, playbackMode, activePlaylist, hasVideo, expanded, upNext, recommendationError, seenIds, openPlayer, closePlayer, playQueue, adoptQueue, playAt, enqueueAndPlay, setRecommendationQueue, refillRecommendations, clearRecommendationError, toggle, next, prev, seekPercent, cycleRepeat, toggleShuffle]
  )

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
}

export function usePlayer() {
  const ctx = useContext(PlayerContext)
  if (!ctx) throw new Error('usePlayer must be used inside <PlayerProvider>')
  return ctx
}
