/**
 * Melody's music provider: the protected /api/music backend, which talks to
 * YouTube Data API v3 with a server-side key.
 *
 * WHY NO DIRECT YOUTUBE CALLS: the API key must never be bundled into browser
 * JavaScript. The backend applies per-IP / per-user rate limits, caches
 * identical queries, tracks quota and bounds retries. The caches below are a
 * second (client-side) layer so even fewer requests leave the device.
 *
 * Callers only ever see Melody's own track shape - no component has to know
 * that YouTube answered.
 */

const TIMEOUT_MS = 20000

/* Cache lifetimes. Search is the expensive one (100 units) so it lives longest. */
const TTL = {
  search: 15 * 60 * 1000, // 15 min
  chart: 10 * 60 * 1000, // 10 min
  channels: 15 * 60 * 1000, // 15 min
  artist: 20 * 60 * 1000, // 20 min
  video: 60 * 60 * 1000, // 1 h (durations/embeddability)
  weak: 60 * 1000, // 1 min (partial answers only)
}

const CACHE_KEY = 'melody:yt:v1'
const CACHE_MAX_ENTRIES = 60
const CACHE_MAX_BYTES = 400000

/* Video ids are always 11 characters; old Audius ids are not. */
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/
const CHANNEL_ID_RE = /^[A-Za-z0-9_-]{1,64}$/

/** True when an id can be played by the YouTube player. */
export function isYouTubeId(id) {
  return VIDEO_ID_RE.test(String(id || ''))
}

/**
 * The provider label shown next to saved tracks. Rows written before the
 * migration still carry Audius ids - they keep saying "Audius", which is both
 * true and the reason they can no longer be played.
 */
export function providerSuffix(id) {
  return isYouTubeId(id) ? ' \u2022 YouTube' : ' \u2022 Audius'
}

export class YoutubeError extends Error {
  constructor(message, status = 502, debug = null) {
    super(message)
    this.name = 'YoutubeError'
    this.status = status
    this.debug = debug
  }
}

/* ------------------------------ tiny cache ------------------------------ */
/* One map in memory, mirrored into localStorage so a reload (or a second tab)
   does not spend the quota again. Both layers fail soft: private mode and a
   full quota simply cost one extra request. */

let store = null
const inflight = new Map() // key -> Promise (one request per key at a time)

function loadStore() {
  if (store) return store
  store = new Map()
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return store
    const now = Date.now()
    const parsed = JSON.parse(raw)
    for (const [k, v] of Object.entries(parsed)) {
      if (v && typeof v.e === 'number' && v.e > now) store.set(k, { value: v.v, expires: v.e })
    }
  } catch {
    store = new Map()
  }
  return store
}

function pruneAndSave() {
  const map = loadStore()
  const now = Date.now()
  for (const [k, v] of map) if (v.expires <= now) map.delete(k)
  while (map.size > CACHE_MAX_ENTRIES) map.delete(map.keys().next().value)

  let out = {}
  try {
    out = {}
    for (const [k, v] of map) out[k] = { v: v.value, e: v.expires }
    let raw = JSON.stringify(out)
    // Drop the oldest entries until the blob fits the budget.
    const keys = [...map.keys()]
    while (raw.length > CACHE_MAX_BYTES && keys.length > 1) {
      const victim = keys.shift()
      map.delete(victim)
      delete out[victim]
      raw = JSON.stringify(out)
    }
    localStorage.setItem(CACHE_KEY, raw)
  } catch {
    /* quota exceeded / private mode: the in-memory cache still works */
  }
}

function cacheGet(key) {
  const hit = loadStore().get(key)
  if (hit && hit.expires > Date.now()) return hit.value
  return null
}

function cacheSet(key, value, ttl) {
  loadStore().set(key, { value, expires: Date.now() + ttl })
  pruneAndSave()
}

/** Run `fn` once per key: parallel callers share the same promise. */
function dedupe(key, fn) {
  const running = inflight.get(key)
  if (running) return running
  const p = Promise.resolve()
    .then(fn)
    .finally(() => inflight.delete(key))
  inflight.set(key, p)
  return p
}

/* -------------------------------- HTTP --------------------------------- */

function isLocalHost() {
  try {
    return /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)
  } catch {
    return false
  }
}

/** Friendly message per backend error code. */
function messageFor(code, status) {
  switch (code) {
    case 'rate_limited':
      return 'Too many music requests. Please wait a moment and try again.'
    case 'quota':
      return "YouTube's API quota is used up for now. Please try again a little later."
    case 'not_configured':
      return 'Music search is not configured on the server yet.'
    case 'timeout':
      return 'YouTube took too long to respond. Please try again.'
    case 'invalid':
      return 'Please check your search and try again.'
    case 'internal':
      return 'Something went wrong while loading music. Please try again.'
    default:
      return status >= 500
        ? 'YouTube is having problems right now. Please try again shortly.'
        : 'Melody could not reach the music service. Please try again.'
  }
}

/** Send the signed-in user's token (if any) so the backend can apply a
 *  per-user limit in addition to the per-IP one. Never sent to YouTube. */
export async function getAuthHeaders() {
  try {
    const { supabase } = await import('./supabase.js')
    if (!supabase) return {}
    const { data } = await supabase.auth.getSession()
    const token = data && data.session && data.session.access_token
    return token ? { Authorization: `Bearer ${token}` } : {}
  } catch {
    return {}
  }
}

/**
 * One GET against OUR backend. The YouTube key is never present here.
 */
async function backendGet(action, params = {}) {
  const url = new URL('/api/music', window.location.origin)
  url.searchParams.set('action', action)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let res
  try {
    const headers = await getAuthHeaders()
    res = await fetch(url, { signal: controller.signal, headers })
  } catch (err) {
    const timedOut = err && err.name === 'AbortError'
    throw new YoutubeError(
      timedOut
        ? 'The music service took too long to respond. Please try again.'
        : 'Could not reach the music service. Check your connection and try again.',
      504,
      debugInfo('GET', action, 0, timedOut ? 'timeout' : String(err && err.message))
    )
  } finally {
    clearTimeout(timer)
  }

  let json = null
  try {
    json = await res.json()
  } catch {
    json = null
  }

  if (!res.ok) {
    const code = (json && json.code) || (res.status === 429 ? 'rate_limited' : '')
    const message = (json && json.error) || messageFor(code, res.status)
    const error = new YoutubeError(message, res.status, debugInfo('GET', action, res.status, code))
    error.code = code
    const retryAfter = Number(res.headers.get('retry-after'))
    if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfter = retryAfter
    throw error
  }
  if (!json || typeof json !== 'object') {
    throw new YoutubeError('Music service sent an unexpected response.', 502, debugInfo('GET', action, res.status, 'non-JSON body'))
  }
  return json
}

/** Technical detail - only attached on localhost, like the old proxy did. */
function debugInfo(method, endpoint, status, detail) {
  if (!isLocalHost()) return null
  return {
    request: `${method} ${endpoint}`,
    http_status: status,
    error: String(detail || '').slice(0, 200),
    hint: 'youtube data api v3',
  }
}

/* ---------------------------- normalisation ---------------------------- */

/** YouTube titles arrive HTML-escaped ("&amp;"). One decode pass only. */
function decodeEntities(s) {
  return String(s || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

function clip(s, len) {
  return String(s || '').slice(0, len)
}

/** "PT4M23S" -> 263 */
function isoToSeconds(iso) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(iso || ''))
  if (!m) return 0
  return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)
}

function pickThumb(thumbs) {
  if (!thumbs || typeof thumbs !== 'object') return ''
  for (const size of ['maxres', 'standard', 'high', 'medium', 'default']) {
    const t = thumbs[size]
    if (t && typeof t.url === 'string' && /^https:\/\//i.test(t.url)) return t.url
  }
  return ''
}

/** True for items that may never play: private, live or not embeddable. */
function isPlayable(video) {
  const status = video.status || {}
  if (status.privacyStatus && status.privacyStatus !== 'public') return false
  if (status.embeddable === false) return false
  const live = video.snippet && video.snippet.liveBroadcastContent
  return live !== 'live' && live !== 'upcoming'
}

/** One YouTube video resource -> Melody's track shape (or null). */
function videoToTrack(video) {
  if (!video || typeof video !== 'object') return null
  const id = String((video.id && video.id.videoId) || video.id || '')
  if (!isYouTubeId(id)) return null
  if (!isPlayable(video)) return null

  const sn = video.snippet || {}
  const title = decodeEntities(sn.title).trim()
  if (!title) return null

  return {
    provider: 'youtube',
    external_id: id,
    title: clip(title, 150),
    artist: clip(decodeEntities(sn.channelTitle).trim() || 'Unknown artist', 150),
    artist_id: clip(String(sn.channelId || ''), 64),
    cover: pickThumb(sn.thumbnails),
    mirrors: [],
    duration: isoToSeconds(video.contentDetails && video.contentDetails.duration),
    genre: '',
    plays: 0,
    streamable: true,
    url: `https://www.youtube.com/watch?v=${id}`,
  }
}

function normalizeVideos(items) {
  const out = []
  const seen = new Set()
  for (const item of Array.isArray(items) ? items : []) {
    const track = videoToTrack(item)
    if (!track || seen.has(track.external_id)) continue
    seen.add(track.external_id)
    out.push(track)
  }
  return out
}

/** One YouTube channel resource -> the artist card shape. */
function channelToArtist(channel) {
  if (!channel || typeof channel !== 'object') return null
  const id = String(channel.id || '')
  if (!CHANNEL_ID_RE.test(id)) return null
  const sn = channel.snippet || {}
  const stats = channel.statistics || {}
  const name = decodeEntities(sn.title).trim()
  if (!name) return null

  const count = (v) => {
    const n = Number(v)
    return Number.isFinite(n) && String(v) !== '' && v !== undefined && v !== null ? Math.max(0, n) : null
  }

  return {
    id,
    name: clip(name, 150),
    handle: clip(decodeEntities(sn.customUrl).trim(), 100),
    avatar: pickThumb(sn.thumbnails),
    track_count: count(stats.videoCount),
    follower_count: stats.hiddenSubscriberCount ? null : count(stats.subscriberCount),
  }
}

/* ------------------------------ fetchers ------------------------------- */

/** Channels seen in any list we loaded, in order - free artist cards. */
const recentChannels = []

function rememberChannels(tracks) {
  for (const t of tracks) {
    if (!t.artist_id || recentChannels.includes(t.artist_id)) continue
    recentChannels.push(t.artist_id)
    if (recentChannels.length > 60) recentChannels.shift()
  }
}

/**
 * Trending / Discover are backend chart actions (cheap videos.list). The
 * client cache is a second layer in front of the backend cache.
 */
async function chartPage(page) {
  const action = page <= 0 ? 'trending' : 'discover'
  const key = `chart:${action}`
  const cached = cacheGet(key)
  if (cached) return cached

  return dedupe(key, async () => {
    const again = cacheGet(key)
    if (again) return again
    const data = await backendGet(action, { limit: 50 })
    const tracks = Array.isArray(data.tracks) ? data.tracks : []
    rememberChannels(tracks)
    cacheSet(key, tracks, TTL.chart)
    return tracks
  })
}

/** Search goes through the rate-limited backend. */
async function searchTracks(query, limit) {
  const text = String(query || '').trim()
  const key = `search:${text.toLowerCase().replace(/\s+/g, ' ')}`

  const cached = cacheGet(key)
  if (cached) return cached.slice(0, limit)

  return dedupe(key, async () => {
    const again = cacheGet(key)
    if (again) return again.slice(0, limit)
    const data = await backendGet('search', { q: text, limit: 20 })
    const tracks = Array.isArray(data.tracks) ? data.tracks : []
    rememberChannels(tracks)
    cacheSet(key, tracks, TTL.search)
    return tracks.slice(0, limit)
  })
}

/** One artist's catalog, cached per channel. */
async function artistTracks(channelId, limit) {
  const id = String(channelId || '')
  if (!CHANNEL_ID_RE.test(id)) throw new YoutubeError('Invalid artist.', 400)

  const key = `artist:${id}`
  const cached = cacheGet(key)
  if (cached) return cached.slice(0, limit)

  return dedupe(key, async () => {
    const again = cacheGet(key)
    if (again) return again.slice(0, limit)
    const data = await backendGet('artist_tracks', { id, limit: 30 })
    const tracks = Array.isArray(data.tracks) ? data.tracks : []
    cacheSet(key, tracks, TTL.artist)
    return tracks.slice(0, limit)
  })
}

/** Artist cards are built by the backend from channels.list (1 unit). */
async function artistsList(limit) {
  const key = 'artists'
  const cached = cacheGet(key)
  if (cached) return cached.slice(0, limit)

  return dedupe(key, async () => {
    const again = cacheGet(key)
    if (again) return again.slice(0, limit)
    const data = await backendGet('artists', { limit: 50 })
    const artists = Array.isArray(data.artists) ? data.artists : []
    cacheSet(key, artists, TTL.channels)
    return artists.slice(0, limit)
  })
}

/* ------------------------------- public ------------------------------- */

/**
 * GET a Melody track/artist list. Drop-in for the old audiusRequest():
 *   { action: 'trending'|'discover'|'artists'|'artist_tracks'|'search', ... }
 * -> { ok: true, tracks | artists, ... }
 */
export async function youtubeRequest(params = {}) {
  const action = String(params.action || '')
  const limit = Math.max(1, Math.min(50, parseInt(params.limit, 10) || 24))

  if (action === 'search') {
    const query = String(params.q || '').slice(0, 100).trim()
    if (!query) throw new YoutubeError('Please enter a search term.', 400)
    const tracks = await searchTracks(query, limit)
    return { ok: true, count: tracks.length, tracks, query }
  }

  if (action === 'recommendations') {
    const seed = {
      id: String(params.id || '').slice(0, 64),
      title: String(params.title || '').slice(0, 150),
      artist: String(params.artist || '').slice(0, 150),
      genre: String(params.genre || '').slice(0, 80),
    }
    if (!seed.id && !seed.title && !seed.artist) {
      throw new YoutubeError('A song is needed for recommendations.', 400)
    }
    const res = await backendGet('recommendations', { ...seed, limit })
    return {
      ok: true,
      count: res.count || 0,
      tracks: Array.isArray(res.tracks) ? res.tracks : [],
      cached: Boolean(res.cached),
      reason: res.reason || '',
    }
  }

  if (action === 'trending') {
    const tracks = (await chartPage(0).catch(() => [])).slice(0, limit)
    if (!tracks.length) throw new YoutubeError('YouTube did not return any tracks.', 502)
    return { ok: true, count: tracks.length, tracks }
  }

  if (action === 'discover') {
    let tracks = await chartPage(1).catch(() => [])
    if (!tracks.length) {
      // No second page (or it failed): differ from Trending the way the old
      // discover row did - same pool, minus the top of the chart.
      const top = await chartPage(0).catch(() => [])
      const head = new Set(top.slice(0, limit).map((t) => t.external_id))
      tracks = top.filter((t) => !head.has(t.external_id))
      if (!tracks.length) tracks = top
    }
    return { ok: true, count: Math.min(tracks.length, limit), tracks: tracks.slice(0, limit) }
  }

  if (action === 'artists') {
    const artists = await artistsList(limit)
    return { ok: true, count: artists.length, artists }
  }

  if (action === 'artist_tracks') {
    const tracks = await artistTracks(params.id, limit)
    return { ok: true, count: tracks.length, tracks }
  }

  throw new YoutubeError('Unknown action.', 400)
}
