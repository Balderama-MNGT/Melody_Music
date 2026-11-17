/**
 * A thin, promise-friendly wrapper around the official YouTube IFrame Player
 * API (https://www.youtube.com/iframe_api).
 *
 * Why a wrapper: PlayerContext's public API is synchronous (toggle(), next(),
 * seekPercent() ...) while the IFrame API arrives asynchronously, so every
 * command issued before the player exists is queued and replayed on ready.
 *
 * React note: YT.Player REPLACES the element it is given, so the wrapper never
 * hands React's own node to the API - it appends an inner <div> to the host
 * first. React then only ever removes the host, which always exists, and the
 * iframe inside it goes away with it.
 *
 * Compliance: the host is always visible while a track is loaded (see the
 * panel styles in style.css). Standard YouTube controls, branding, links and
 * ads are left untouched; the mini-player is an ADDITIONAL controller that
 * issues commands through this official IFrame Player API wrapper. No overlay
 * is placed over the iframe and no undocumented player DOM changes are made.
 */

const API_SRC = 'https://www.youtube.com/iframe_api'
const API_TIMEOUT_MS = 15000

/**
 * Turn an IFrame onError event into `{ code, videoId }`.
 * `getVideoData()` is authoritative for what the player actually tried to
 * play (it still reports the OLD id until a new load lands); the id we last
 * asked for is the fallback when the player is too broken to answer.
 */
function videoErrorOf(e, lastRequestedId) {
  const code = Number(e && e.data)
  let videoId = null
  try {
    const data = e && e.target && typeof e.target.getVideoData === 'function' ? e.target.getVideoData() : null
    if (data && data.video_id) videoId = data.video_id
  } catch {
    /* player in a partial state - fall back to what we requested */
  }
  if (!videoId && lastRequestedId) videoId = lastRequestedId
  return { code: Number.isFinite(code) ? code : 0, videoId }
}

/* YT.PlayerState values (documented constants). */
export const YT_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
}

let apiPromise = null

/** Load the IFrame API once per page; resolves with window.YT. */
export function loadYouTubeApi() {
  if (apiPromise) return apiPromise

  apiPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('The YouTube player needs a browser.'))
      return
    }
    if (window.YT && window.YT.Player) {
      resolve(window.YT)
      return
    }

    const previous = window.onYouTubeIframeAPIReady
    const settle = (fn, value) => {
      clearTimeout(timer)
      window.onYouTubeIframeAPIReady = previous
      fn(value)
    }
    window.onYouTubeIframeAPIReady = () => {
      if (typeof previous === 'function') {
        try {
          previous()
        } catch {
          /* someone else's hook: never let it break ours */
        }
      }
      if (window.YT && window.YT.Player) settle(resolve, window.YT)
      else settle(reject, new Error('The YouTube player did not start.'))
    }

    const script = document.createElement('script')
    script.src = API_SRC
    script.async = true
    script.onerror = () => {
      apiPromise = null // let the next attempt start over
      settle(reject, new Error('Could not load the YouTube player. Check your connection.'))
    }
    document.head.appendChild(script)

    const timer = setTimeout(() => {
      apiPromise = null
      settle(reject, new Error('The YouTube player took too long to load.'))
    }, API_TIMEOUT_MS)
  })

  return apiPromise
}

/**
 * One player bound to one host element.
 *
 *   new YtPlayer(host, { onReady, onState, onVideoError, onPlayerError })
 *
 * Commands before the API is ready are queued, so callers never have to wait.
 */
export class YtPlayer {
  constructor(host, handlers = {}) {
    this.host = host
    this.handlers = handlers
    this.player = null
    /* The IFrame API accepts commands only AFTER onReady. The player object
       exists before that and silently ignores what it is sent, so commands
       must be queued until this flips - firing early loses them for good. */
    this.ready = false
    this.pending = []
    this.destroyed = false
    /* the id of the video most recently asked for - the fallback a late
       onError needs when getVideoData() can no longer answer */
    this.videoId = null
    /* The newest load request, held on its own (not in `pending`) so a load
       asked for before onReady can never fire after a newer one and clobber
       it: the slot is overwritten by every load and emptied when run. */
    this.pendingLoad = null

    loadYouTubeApi()
      .then((YT) => this.create(YT))
      .catch((err) => {
        if (this.destroyed) return
        this.handlers.onPlayerError?.(err)
      })
  }

  create(YT) {
    if (this.destroyed || !this.host) return
    // YT.Player replaces the element it is given: never hand it React's node.
    const inner = document.createElement('div')
    inner.className = 'yt-frame'
    this.host.appendChild(inner)

    this.player = new YT.Player(inner, {
      width: '100%',
      height: '100%',
      playerVars: {
        /* Only documented, policy-compatible parameters. controls/keyboard/
           fullscreen remain at their defaults so YouTube's native interface,
           branding and links stay fully usable; the mini-player is additive. */
        enablejsapi: 1,
        rel: 0,
        playsinline: 1,
        origin: window.location.origin,
      },
      events: {
        onReady: () => {
          this.ready = true
          this.flush()
          this.handlers.onReady?.()
        },
        onStateChange: (e) => {
          /* The event carries its own player: read the video id from it so a
             late ENDED can be matched against the track that really ended. */
          let videoId = null
          try {
            const data = e && e.target && typeof e.target.getVideoData === 'function'
              ? e.target.getVideoData()
              : null
            videoId = (data && data.video_id) || null
          } catch {
            /* partial player state - the app falls back to the current track */
          }
          this.handlers.onState?.(e.data, videoId)
        },
        /* The IFrame API reports both the code (2/5/100/101/150) and, through
           the player, WHICH video failed. Both matter: the code picks the
           message, the id stops a late event from being blamed on whatever
           track is selected by the time it arrives. */
        onError: (e) => this.handlers.onVideoError?.(videoErrorOf(e, this.videoId)),
      },
    })
  }

  /** Run `fn(player)` now, or as soon as the player may be commanded. */
  send(fn) {
    if (this.destroyed) return
    if (this.player && this.ready) {
      try {
        fn(this.player)
      } catch {
        /* a stale/invalid call must never break playback */
      }
      return
    }
    this.pending.push(fn)
  }

  flush() {
    const queued = this.pending
    this.pending = []
    for (const fn of queued) this.send(fn)
    this.runPendingLoad()
  }

  /** Play the newest requested video, if there is one still outstanding. */
  runPendingLoad() {
    const want = this.pendingLoad
    /* Not commandable yet: leave the slot in place so onReady still runs it
       (a newer load overwriting it is unchanged - newest request wins). */
    if (!want || !this.player || !this.ready || this.destroyed) return
    this.pendingLoad = null
    this.send((p) => {
      if (want.autoplay) p.loadVideoById(want.videoId)
      else p.cueVideoById(want.videoId)
    })
  }

  /** autoplay -> load and start; otherwise load and wait for the play button. */
  load(videoId, autoplay) {
    this.videoId = videoId
    /* Newest request wins - it replaces anything still waiting for onReady. */
    this.pendingLoad = { videoId, autoplay }
    if (this.player) this.runPendingLoad()
  }

  play() {
    this.send((p) => p.playVideo())
  }

  pause() {
    this.send((p) => p.pauseVideo())
  }

  stop() {
    this.send((p) => p.stopVideo())
  }

  seek(seconds) {
    const s = Math.max(0, Number(seconds) || 0)
    this.send((p) => p.seekTo(s, true))
  }

  /** Melody's volume is 0..1, the IFrame API wants 0..100. */
  setVolume(value) {
    const v = Math.max(0, Math.min(100, Math.round((Number(value) || 0) * 100)))
    this.send((p) => p.setVolume(v))
  }

  getTime() {
    try {
      return this.player ? Number(this.player.getCurrentTime()) || 0 : 0
    } catch {
      return 0
    }
  }

  /** Current state (YT_STATE values) - toggle() needs it to decide play/pause. */
  getState() {
    try {
      if (this.player && typeof this.player.getPlayerState === 'function') {
        const s = Number(this.player.getPlayerState())
        if (Number.isFinite(s)) return s
      }
    } catch {
      /* not created (yet) */
    }
    return YT_STATE.UNSTARTED
  }

  getDuration() {
    try {
      return this.player ? Number(this.player.getDuration()) || 0 : 0
    } catch {
      return 0
    }
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.ready = false
    this.pending = []
    this.pendingLoad = null
    const p = this.player
    this.player = null
    if (!p) return
    try {
      p.destroy()
    } catch {
      /* already gone */
    }
  }
}
