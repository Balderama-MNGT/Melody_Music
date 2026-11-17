/**
 * Shared /api/music handler used by both Vercel and the local dev server.
 * Responsibilities: CORS, validation, rate limiting, caching, quota safety,
 * metrics and user-friendly errors. No YouTube key ever leaves this layer.
 */
import { createHash } from 'node:crypto'
import { config } from './config.js'
import { cacheGet, cacheSet, dedupe, metrics, rateCheck } from './store.js'
import {
  ApiError,
  channels,
  channelToArtist,
  chart,
  normalizeVideos,
  isMusicRelated,
  searchVideos,
  videoDetails,
  artistVideos,
} from './youtube.js'
import {
  inferStyle,
  recommendationQueries,
  rankRecommendations,
  seedCacheKey,
} from './recommendations.js'

const ACTIONS = new Set([
  'search',
  'recommendations',
  'trending',
  'discover',
  'artists',
  'artist_tracks',
])

export function json(res, status, body, extraHeaders = {}) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v)
  res.end(JSON.stringify(body))
}

export function originAllowed(req) {
  const origin = String(req.headers.origin || '')
  if (!origin) return true // same-origin / server-to-server
  return config.allowedOrigins.includes(origin)
}

function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '')
  const first = fwd.split(',')[0].trim()
  if (first) return first
  return String(req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown').trim()
}

/** Verify a Supabase access token; used ONLY as a rate-limit identity. */
export async function verifiedUserId(req) {
  const auth = String(req.headers.authorization || '')
  if (!/^Bearer\s+\S+$/i.test(auth)) return null
  if (!config.supabaseUrl || !config.supabaseAnonKey) return null
  const token = auth.replace(/^Bearer\s+/i, '')
  const hash = createHash('sha256').update(token).digest('hex').slice(0, 24)
  const cached = await cacheGet(`auth:${hash}`)
  if (cached) return cached.id || null
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2500)
    const res = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: config.supabaseAnonKey },
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) return null
    const user = await res.json()
    const id = user && typeof user.id === 'string' ? user.id : null
    if (id) await cacheSet(`auth:${hash}`, { id }, 300_000)
    return id
  } catch {
    return null
  }
}

function sanitizeQuery(raw) {
  return String(raw || '')
    /* eslint-disable-next-line no-control-regex */
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, 100)
}

function limitFor(action, userId) {
  /* Endpoint-specific buckets: a burst of chart/artist browsing can never eat
     the search allowance, and vice versa. Authenticated users also get their
     own budget on top of the shared per-IP bucket. */
  const bucket =
    action === 'search' || action === 'recommendations'
      ? { name: 'search', ip: config.limits.searchIpMax, user: config.limits.searchUserMax }
      : action === 'artists' || action === 'artist_tracks'
        ? { name: 'artist', ip: config.limits.artistIpMax, user: config.limits.artistUserMax }
        : { name: 'chart', ip: config.limits.chartIpMax, user: config.limits.chartUserMax }
  return [
    { key: `ip:${clientIpKey}`, limit: bucket.ip },
    ...(userId
      ? [{ key: `user:${userId}:${bucket.name}`, limit: bucket.user }]
      : []),
  ]
}

/* clientIpKey is set per request (module scope avoids threading it everywhere) */
let clientIpKey = 'unknown'

async function applyLimits(action, userId) {
  const checks = limitFor(action, userId)
  let worst = null
  for (const c of checks) {
    const r = await rateCheck(c.key, c.limit, config.limits.windowMs)
    if (!r.allowed) {
      metrics.limited++
      worst = worst && worst.retryAfter >= r.retryAfter ? worst : r
    }
  }
  return worst
}

async function runAction(action, params) {
  const limit = Math.max(1, Math.min(50, parseInt(params.limit, 10) || 24))

  if (action === 'recommendations') {
    const seed = {
      external_id: sanitizeQuery(params.id),
      title: sanitizeQuery(params.title),
      artist: sanitizeQuery(params.artist),
      genre: sanitizeQuery(params.genre),
    }
    if (!seed.external_id && !seed.title && !seed.artist) {
      throw new ApiError('A song is needed for recommendations.', 400, 'invalid')
    }
    const key = seedCacheKey(seed)
    const cached = await cacheGet(key)
    if (cached) {
      return { ok: true, count: cached.length, tracks: cached.slice(0, limit), cached: true }
    }
    return dedupe(key, async () => {
      const again = await cacheGet(key)
      if (again) return { ok: true, count: again.length, tracks: again.slice(0, limit), cached: true }

      const style = inferStyle(seed)
      const queries = recommendationQueries(seed, config.recommend.maxQueries)
      const collected = []
      const seen = new Set(seed.external_id ? [seed.external_id] : [])

      for (let i = 0; i < queries.length; i++) {
        /* Only the final strategy may spend a second search on the topic
           fallback; earlier broad queries already cover most genres. */
        const allowFallback = i === queries.length - 1 && collected.length < config.recommend.minResults
        const raw = await searchVideos(queries[i], { allowFallback })
        if (raw.length) {
          const ids = raw
            .map((item) => item.id.videoId)
            .filter((id) => !seen.has(id))
            .slice(0, 40)
          if (ids.length) {
            const details = await videoDetails(ids)
            const byId = new Map(details.map((d) => [d.id, d]))
            const enriched = raw
              .map((item, rank) => ({ ...(byId.get(item.id.videoId) || item), __rank: rank }))
              .filter(isMusicRelated)
            const ranked = rankRecommendations(normalizeVideos(enriched), seed, style)
            for (const track of ranked) {
              if (seen.has(track.external_id)) continue
              seen.add(track.external_id)
              collected.push(track)
            }
          }
        }
        if (collected.length >= config.recommend.minResults) break
      }

      /* Errors (429 / quota / upstream) are intentionally NOT cached here:
         they propagate to the client so it can show the right message. */
      await cacheSet(
        key,
        collected,
        collected.length ? config.recommend.ttl : config.recommend.emptyTtl
      )
      return {
        ok: true,
        count: collected.length,
        tracks: collected.slice(0, limit),
        cached: false,
        reason: collected.length ? '' : 'no_results',
      }
    })
  }

  if (action === 'search') {
    const query = sanitizeQuery(params.q)
    if (!query) throw new ApiError('Please enter a search term.', 400, 'invalid')
    const key = `search:${query.toLowerCase().replace(/\s+/g, ' ')}`
    let tracks = await cacheGet(key)
    if (!tracks) {
      tracks = await dedupe(key, async () => {
        const again = await cacheGet(key)
        if (again) return again
        const raw = await searchVideos(query)
        if (!raw.length) return []
        const ids = raw.map((i) => i.id.videoId).slice(0, 50)
        const details = await videoDetails(ids)
        const byId = new Map(details.map((d) => [d.id, d]))
        /* Enrich first, then filter on title + description + channel + tags +
           category. Keep search relevance order; de-duplication is by id. */
        const enriched = raw
          .map((item, rank) => {
            const full = byId.get(item.id.videoId)
            return { ...(full || item), __rank: rank }
          })
          .filter(isMusicRelated)
          .sort((a, b) => a.__rank - b.__rank)
        const normalized = normalizeVideos(enriched)
        await cacheSet(
          key,
          normalized,
          normalized.length ? config.cache.searchTtl : config.cache.emptySearchTtl
        )
        return normalized
      })
    }
    return { ok: true, count: tracks.length, tracks: tracks.slice(0, limit), query }
  }

  if (action === 'trending' || action === 'discover') {
    const key = `chart:${action === 'trending' ? 'top' : 'next'}`
    let tracks = await cacheGet(key)
    if (!tracks) {
      tracks = await dedupe(key, async () => {
        let data = await chart(action === 'trending' ? '' : (await cacheGet('chart:token')) || '')
        if (action === 'discover' && !data.items.length) data = await chart('')
        const normalized = normalizeVideos(data.items)
        await cacheSet(
          key,
          normalized,
          normalized.length ? config.cache.chartTtl : config.cache.emptySearchTtl
        )
        if (data.nextPageToken) await cacheSet('chart:token', data.nextPageToken, config.cache.chartTtl)
        return normalized
      })
    }
    if (action === 'discover' && tracks.length) {
      const head = new Set((await cacheGet('chart:top') || []).map((t) => t.external_id))
      const rest = tracks.filter((t) => !head.has(t.external_id))
      if (rest.length) tracks = rest
    }
    return { ok: true, count: Math.min(tracks.length, limit), tracks: tracks.slice(0, limit) }
  }

  if (action === 'artists') {
    const key = 'artists'
    let artists = await cacheGet(key)
    if (!artists) {
      artists = await dedupe(key, async () => {
        const top = await cacheGet('chart:top') || normalizeVideos((await chart('')).items)
        const ids = [...new Set(top.map((t) => t.artist_id).filter(Boolean))].slice(0, 50)
        if (!ids.length) return []
        const json = await channels(ids)
        const list = (json.items || []).map(channelToArtist).filter(Boolean)
        await cacheSet(key, list, config.cache.channelTtl)
        return list
      })
    }
    return { ok: true, count: artists.length, artists: artists.slice(0, limit) }
  }

  if (action === 'artist_tracks') {
    const id = String(params.id || '')
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new ApiError('Invalid artist.', 400, 'invalid')
    const key = `artist:${id}`
    let tracks = await cacheGet(key)
    if (!tracks) {
      tracks = await dedupe(key, async () => {
        const raw = await artistVideos(id)
        const ids = raw.map((i) => i.id.videoId).slice(0, 50)
        const details = ids.length ? await videoDetails(ids) : []
        const byId = new Map(details.map((d) => [d.id, d]))
        const normalized = normalizeVideos(raw.map((i) => byId.get(i.id.videoId) || i))
        await cacheSet(key, normalized, config.cache.artistTtl)
        return normalized
      })
    }
    return { ok: true, count: tracks.length, tracks: tracks.slice(0, limit) }
  }

  throw new ApiError('Unknown action.', 400, 'invalid')
}

export async function handleMusic(req, res) {
  const started = Date.now()
  metrics.requests++
  const headers = {
    'Access-Control-Allow-Origin': originAllowed(req) ? String(req.headers.origin || '*') : 'null',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Max-Age': '600',
  }
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)

  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  if (req.method !== 'GET') {
    metrics.invalid++
    return json(res, 405, { ok: false, error: 'Method not allowed.' })
  }
  if (!originAllowed(req)) {
    metrics.invalid++
    return json(res, 403, { ok: false, error: 'Origin not allowed.' })
  }

  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
    const action = String(url.searchParams.get('action') || '')
    if (!ACTIONS.has(action)) {
      metrics.invalid++
      return json(res, 400, { ok: false, error: 'Invalid request.' })
    }

    clientIpKey = clientIp(req)
    const userId = await verifiedUserId(req)
    const blocked = await applyLimits(action, userId)
    if (blocked) {
      return json(
        res,
        429,
        { ok: false, error: 'Too many requests. Please slow down and try again.', code: 'rate_limited' },
        { 'Retry-After': String(blocked.retryAfter) }
      )
    }

    const params = {}
    for (const key of ['q', 'id', 'limit', 'title', 'artist', 'genre']) {
      const value = url.searchParams.get(key)
      if (value !== null) params[key] = value
    }

    const data = await runAction(action, params)
    metrics.byAction[action] = (metrics.byAction[action] || 0) + 1
    metrics.measured++
    metrics.totalMs += Date.now() - started
    return json(res, 200, data)
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 500
    const code = err instanceof ApiError ? err.code : 'internal'
    const message =
      err instanceof ApiError
        ? err.message
        : 'Something went wrong while loading music. Please try again.'
    if (!(err instanceof ApiError)) console.error('[api/music] unexpected error:', err && err.message)
    metrics.measured++
    metrics.totalMs += Date.now() - started
    return json(res, status, { ok: false, error: message, code })
  }
}
