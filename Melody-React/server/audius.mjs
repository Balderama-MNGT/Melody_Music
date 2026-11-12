/**
 * Audius API client (server side) - a port of the PHP client in
 * Melody/includes/audius.php.
 *
 * - Credentials come from the server environment and never reach the browser.
 * - Track metadata and stream URLs are always fetched here, never trusted
 *   from the client.
 * - Auth order matches the PHP app: Bearer token -> API key + secret (Basic)
 *   -> none. Without any credential the public endpoints still work when they
 *   are called with app_name (https://api.audius.co).
 */

const DEFAULT_API_BASE = 'https://api.audius.co/v1'
const DEFAULT_APP_NAME = 'Melody'
const TIMEOUT_MS = 8000
const CACHE_TTL_MS = 120000 // 120s, like cache_ttl in config/audius.php

function env(name) {
  const v = process.env[name]
  return typeof v === 'string' ? v.trim() : ''
}

function config() {
  return {
    apiBase: env('AUDIUS_API_BASE') || DEFAULT_API_BASE,
    appName: env('AUDIUS_APP_NAME') || DEFAULT_APP_NAME,
    apiKey: env('AUDIUS_API_KEY'),
    apiSecret: env('AUDIUS_API_SECRET'),
    bearerToken: env('AUDIUS_BEARER_TOKEN'),
  }
}

/** Remove any configured secret from text before it is logged or displayed. */
function redact(text) {
  const cfg = config()
  let out = String(text)
  for (const secret of [cfg.bearerToken, cfg.apiKey, cfg.apiSecret]) {
    if (secret) out = out.split(secret).join('***')
  }
  return out
}

export class AudiusError extends Error {
  constructor(message, status = 502, debug = null) {
    super(message)
    this.name = 'AudiusError'
    this.status = status
    this.debug = debug
  }
}

/* ------------------------- tiny in-memory cache ------------------------- */
/* Rate-limit friendly; one instance = one warm cache (good enough for lists). */
const cache = new Map() // key -> { value, expires }

function cacheGet(key, ttlMs = CACHE_TTL_MS) {
  const hit = cache.get(key)
  if (hit && hit.expires > Date.now()) return hit.value
  return null
}

function cacheSet(key, value, ttlMs = CACHE_TTL_MS) {
  if (cache.size > 500) {
    const now = Date.now()
    for (const [k, v] of cache) if (v.expires <= now) cache.delete(k)
    if (cache.size > 500) cache.delete(cache.keys().next().value)
  }
  cache.set(key, { value, expires: Date.now() + ttlMs })
}

/* -------------------------------- HTTP --------------------------------- */

/**
 * One GET against the Audius API. Never throws for HTTP problems: it returns
 * { status, body, location, auth, error } exactly like audius_http_request().
 */
async function httpGet(path, query = {}) {
  const cfg = config()
  const out = { status: 0, body: '', location: null, auth: 'none', error: '', url: '' }

  const auth = cfg.bearerToken ? 'bearer' : cfg.apiKey && cfg.apiSecret ? 'basic' : 'none'

  const url = new URL(cfg.apiBase.replace(/\/+$/, '') + path)
  url.searchParams.set('app_name', cfg.appName)
  if (cfg.apiKey && ['key', 'bearer', 'basic'].includes(auth)) {
    url.searchParams.set('api_key', cfg.apiKey)
  }
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value))
  }

  const headers = {
    Accept: 'application/json',
    'User-Agent': `Melody/1.0 (${cfg.appName})`,
  }
  if (auth === 'bearer') headers.Authorization = `Bearer ${cfg.bearerToken}`
  else if (auth === 'basic') {
    headers.Authorization = `Basic ${Buffer.from(`${cfg.apiKey}:${cfg.apiSecret}`).toString('base64')}`
  }
  out.auth = auth
  out.url = redact(url.toString())

  let res
  try {
    res = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (err) {
    out.error = err?.message || String(err)
    out.status = 0
    return out
  }

  out.status = res.status
  out.location = res.headers.get('location')
  try {
    out.body = await res.text()
  } catch {
    out.body = ''
  }
  return out
}

/** Debug payload (only ever shown to localhost, like melody_debug() in PHP). */
function debugInfo(r, hint) {
  return {
    request: `GET ${r.url}`,
    auth_used: r.auth,
    http_status: r.status,
    error: redact(r.error || ''),
    upstream: redact((r.body || '').trim().slice(0, 300)),
    hint,
  }
}

/**
 * GET $path on the Audius API and decode JSON.
 * @throws {AudiusError} with a message that is safe to show to users.
 */
async function apiGet(path, query = {}) {
  const cfg = config()
  const r = await httpGet(path, query)
  const path1 = String(path).split('?')[0]

  if (r.status === 0) {
    throw new AudiusError(
      'Could not reach Audius. Check your internet connection and try again.',
      502,
      debugInfo(r, 'Transport failure: DNS/TLS/timeout.')
    )
  }

  if (r.status >= 300 && r.status < 400 && r.location) {
    return { __redirect: r.location }
  }
  if (r.status === 429) {
    throw new AudiusError(
      'Audius is limiting requests right now (free plan: 10 per second). Please try again in a moment.',
      429,
      debugInfo(r, path1)
    )
  }
  if (r.status === 401 || r.status === 403) {
    if (!cfg.bearerToken && !cfg.apiKey) {
      throw new AudiusError(
        'Audius needs API credentials. Create a free key at https://api.audius.co/plans and set ' +
          'AUDIUS_BEARER_TOKEN in your environment.',
        502,
        debugInfo(r, path1)
      )
    }
    throw new AudiusError(
      `Audius rejected the configured credentials (HTTP ${r.status}). Re-check AUDIUS_BEARER_TOKEN / AUDIUS_API_KEY.`,
      502,
      debugInfo(r, path1)
    )
  }
  if (r.status === 404) {
    throw new AudiusError('Not found on Audius - it may have been removed.', 404, debugInfo(r, path1))
  }
  if (r.status >= 500 || r.status < 200) {
    throw new AudiusError('Audius is having problems right now. Please try again shortly.', 502, debugInfo(r, path1))
  }
  if (r.status >= 400) {
    throw new AudiusError(`Audius could not process that request (HTTP ${r.status}).`, 400, debugInfo(r, path1))
  }

  let json
  try {
    json = JSON.parse(r.body)
  } catch {
    json = null
  }
  if (!json || typeof json !== 'object') {
    throw new AudiusError('Audius sent an unexpected (non-JSON) response.', 502, debugInfo(r, path1))
  }
  return json
}

/* --------------------------- normalisation ------------------------------ */

const ID_RE = /^[A-Za-z0-9]{1,32}$/

export function isValidTrackId(id) {
  return ID_RE.test(String(id || ''))
}

function clip(s, len) {
  return String(s || '').slice(0, len)
}

/** One raw Audius track -> Melody's shape, or null if unusable. */
function normalizeTrack(t) {
  if (!t || typeof t !== 'object') return null
  const id = String(t.id || '')
  if (!ID_RE.test(id)) return null
  const title = String(t.title || '').trim()
  if (title === '') return null

  const user = t.user && typeof t.user === 'object' ? t.user : {}
  const artist = String(user.name || '').trim() || String(user.handle || '').trim() || 'Unknown artist'

  const art = t.artwork && typeof t.artwork === 'object' ? t.artwork : {}
  let cover = ''
  for (const size of ['480x480', '1000x1000', '150x150']) {
    const value = art[size]
    if (typeof value === 'string' && /^https:\/\//i.test(value)) {
      cover = value
      break
    }
  }

  // Mirror hosts let the player retry artwork when one content node is down
  // (https://docs.audius.co - "Image Loading & Mirrors").
  const mirrors = []
  if (Array.isArray(art.mirrors)) {
    for (const m of art.mirrors) {
      if (typeof m === 'string' && /^https?:\/\//i.test(m)) mirrors.push(m.replace(/\/+$/, ''))
    }
  }

  const streamable =
    t.is_streamable !== false && (!t.access || t.access.stream !== false)

  const permalink = String(t.permalink || '')
  const pageUrl = permalink.startsWith('/') ? `https://audius.co${permalink}` : ''

  return {
    provider: 'audius',
    external_id: id,
    title: clip(title, 150),
    artist: clip(artist, 150),
    artist_id: clip(String(user.id || '').trim(), 32),
    cover,
    mirrors: [...new Set(mirrors)].slice(0, 4),
    duration: Math.max(0, Number(t.duration) || 0),
    genre: clip(String(t.genre || '').trim(), 50),
    plays: Math.max(0, Number(t.play_count) || 0),
    streamable,
    url: clip(pageUrl, 500),
  }
}

function normalizeList(raw) {
  const out = []
  for (const t of Array.isArray(raw?.data) ? raw.data : []) {
    const n = normalizeTrack(t)
    if (n) {
      out.push(n)
      cacheSet(`track:${n.external_id}`, n, 3600000) // an hour, like audius_get_track()
    }
  }
  return out
}

function normalizeArtist(u) {
  if (!u || typeof u !== 'object') return null
  const id = String(u.id || u.user_id || '')
  if (!ID_RE.test(id)) return null

  const handle = String(u.handle || '').trim()
  let name = String(u.name || '').trim()
  if (!name && handle) name = `@${handle}`
  if (!name) name = 'Unknown artist'

  const pic = u.profile_picture && typeof u.profile_picture === 'object' ? u.profile_picture : {}
  let avatar = ''
  for (const size of ['480x480', '150x150', '1000x1000']) {
    const value = pic[size]
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
      avatar = value
      break
    }
  }

  return {
    id,
    name: clip(name, 150),
    handle: clip(handle, 100),
    avatar,
    track_count: Number.isFinite(Number(u.track_count)) && u.track_count !== null && u.track_count !== undefined && String(u.track_count) !== ''
      ? Math.max(0, Number(u.track_count))
      : null,
    follower_count: Number.isFinite(Number(u.follower_count)) && u.follower_count !== null && u.follower_count !== undefined && String(u.follower_count) !== ''
      ? Math.max(0, Number(u.follower_count))
      : null,
  }
}

/* --------------------------- API operations ----------------------------- */

/** GET /tracks/trending (time = week | month | allTime, plus offset paging). */
export async function audiusTrending({ limit = 24, time = 'week', genre = '', offset = 0 } = {}) {
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 24))
  const safeTime = ['week', 'month', 'allTime'].includes(time) ? time : 'week'
  const safeOffset = Math.max(0, Math.min(1000, Number(offset) || 0))

  const query = { limit: safeLimit, time: safeTime }
  if (genre) query.genre = genre
  if (safeOffset > 0) query.offset = safeOffset

  const key = `trending:${JSON.stringify(query)}`
  const hit = cacheGet(key)
  if (hit) return hit

  const tracks = normalizeList(await apiGet('/tracks/trending', query))
  cacheSet(key, tracks)
  return tracks
}

/**
 * Discover: real chart tracks chosen to differ from the weekly trending row -
 * month + all-time charts plus deeper trending pages, with anything already
 * shown in Trending removed first (audius_discover() in PHP).
 */
export async function audiusDiscover(limit = 18) {
  const safeLimit = Math.max(4, Math.min(40, Number(limit) || 18))
  const key = `discover:${safeLimit}`
  const hit = cacheGet(key)
  if (hit) return hit

  const exclude = new Set()
  try {
    for (const t of await audiusTrending({ limit: 50, time: 'week' })) exclude.add(t.external_id)
  } catch {
    /* one weak source must not break the row */
  }

  const pool = []
  const seen = new Set()
  for (const [time, offset] of [
    ['month', 0],
    ['allTime', 0],
    ['week', 50],
  ]) {
    let items = []
    try {
      items = await audiusTrending({ limit: safeLimit, time, offset })
    } catch {
      continue
    }
    for (const t of items) {
      if (seen.has(t.external_id)) continue
      seen.add(t.external_id)
      pool.push(t)
    }
  }

  const out = []
  const added = new Set()
  for (const t of pool) {
    if (exclude.has(t.external_id)) continue
    out.push(t)
    added.add(t.external_id)
    if (out.length >= safeLimit) break
  }
  for (const t of pool) {
    if (out.length >= safeLimit) break
    if (added.has(t.external_id)) continue
    out.push(t)
    added.add(t.external_id)
  }

  const result = out.slice(0, safeLimit)
  cacheSet(key, result)
  return result
}

/** Real artists taken from the live trending charts (nothing is invented). */
export async function audiusArtists(limit = 12) {
  const safeLimit = Math.max(4, Math.min(24, Number(limit) || 12))
  const key = `artists:${safeLimit}`
  const hit = cacheGet(key, 240000)
  if (hit) return hit

  const out = []
  const seen = new Set()
  for (const time of ['week', 'month']) {
    if (out.length >= safeLimit) break
    let raw
    try {
      raw = await apiGet('/tracks/trending', { limit: 50, time })
    } catch {
      continue
    }
    for (const t of Array.isArray(raw?.data) ? raw.data : []) {
      if (out.length >= safeLimit) break
      if (!t || typeof t !== 'object' || !t.user) continue
      const a = normalizeArtist(t.user)
      if (!a || seen.has(a.id)) continue
      if (a.track_count !== null && a.track_count < 1) continue // no music to show
      seen.add(a.id)
      out.push(a)
    }
  }

  cacheSet(key, out, 240000)
  return out
}

/** GET /users/{id}/tracks - one artist's real uploaded catalog. */
export async function audiusArtistTracks(userId, limit = 30) {
  if (!isValidTrackId(userId)) throw new AudiusError('Invalid artist.', 400)
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 30))
  const key = `artist_tracks:${userId}:${safeLimit}`
  const hit = cacheGet(key, 240000)
  if (hit) return hit

  const tracks = normalizeList(
    await apiGet(`/users/${encodeURIComponent(userId)}/tracks`, { limit: safeLimit })
  )
  cacheSet(key, tracks, 240000)
  return tracks
}

export async function audiusSearch(query, limit = 24) {
  const text = String(query || '').slice(0, 100)
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 24))
  const key = `search:${text.toLowerCase()}:${safeLimit}`
  const hit = cacheGet(key)
  if (hit) return hit

  const tracks = normalizeList(await apiGet('/tracks/search', { query: text, limit: safeLimit }))
  cacheSet(key, tracks)
  return tracks
}

/**
 * Resolve the playable media URL through the documented stream endpoint
 * (GET /tracks/{id}/stream?no_redirect=true). Short-lived: cached 4 minutes.
 */
export async function audiusResolveStreamUrl(id) {
  if (!isValidTrackId(id)) throw new AudiusError('Invalid track.', 400)
  const key = `stream:${id}`
  const hit = cacheGet(key, 240000)
  if (typeof hit === 'string' && hit) return hit

  const raw = await apiGet(`/tracks/${encodeURIComponent(id)}/stream`, { no_redirect: 'true' })
  const url = typeof raw.__redirect === 'string' ? raw.__redirect : raw.data
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    throw new AudiusError('This track cannot be streamed right now.', 502)
  }
  cacheSet(key, url, 240000)
  return url
}
