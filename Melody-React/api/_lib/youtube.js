/**
 * Server-side YouTube Data API v3 client.
 * The API key is read only from process.env here - it is never sent to the
 * browser. Every call is timeout-bounded, retry-bounded and quota-accounted.
 */
import { config } from './config.js'
import { cacheGet, cacheSet, dedupe, metrics, quotaStatusShared, recordQuota } from './store.js'

const API = 'https://www.googleapis.com/youtube/v3'

export class ApiError extends Error {
  constructor(message, status = 502, code = 'upstream') {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const jitter = () => Math.floor(Math.random() * 200)

export function classify(res, reason, detail = '') {
  const why = String(reason || '')
  const text = String(detail || '')
  if (res.status === 403 && /quota|dailyLimit|rateLimit/i.test(why)) {
    return new ApiError("YouTube's API quota is exhausted. Please try again later.", 503, 'quota')
  }
  if (res.status === 429) {
    return new ApiError('YouTube is rate limiting requests. Please try again shortly.', 503, 'quota')
  }
  if (res.status === 400) {
    return new ApiError('YouTube rejected that request. Please try different words.', 400, 'invalid')
  }
  /* The observed Vercel failure: HTTP 403 reason "forbidden", message
     "Permission denied on the service", caused by an HTTP-referrer restricted
     key receiving a server-side request with no Referer. Never include the key. */
  if (
    res.status === 403 &&
    (/apikey|keyinvalid|accessnotconfigured|forbidden|referer|iprefererblocked|browserkey|credential/i.test(why) ||
      /permission denied on the service/i.test(text))
  ) {
    return new ApiError(
      'YouTube rejected the server API key restrictions (HTTP 403 forbidden). ' +
        'Set YOUTUBE_REFERER to the deployed origin or remove the key’s HTTP-referrer restriction.',
      502,
      'key_restricted'
    )
  }
  const suffix = why ? ` (${why})` : ''
  return new ApiError(`YouTube returned HTTP ${res.status}${suffix}. Please try again.`, 502, 'upstream')
}

/** One fetch with a hard timeout. */
async function once(url, headers = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.upstream.timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal, headers })
    let json = null
    try {
      json = await res.json()
    } catch {
      /* handled below */
    }
    return { res, json }
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new ApiError('YouTube took too long to respond. Please try again.', 504, 'timeout')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

export async function ytGet(endpoint, params, cost = 1) {
  if (!config.youtubeKey) {
    throw new ApiError('Music search is not configured on the server yet.', 503, 'not_configured')
  }
  const url = new URL(`${API}/${endpoint}`)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v))
  }
  url.searchParams.set('key', config.youtubeKey)

  const quota = await quotaStatusShared()
  if (quota.used + cost > quota.dailyLimit) {
    metrics.quotaErrors++
    throw new ApiError("YouTube's daily quota is exhausted. Please try again later.", 503, 'quota')
  }

  let lastError = null
  for (let attempt = 0; attempt <= config.upstream.maxRetries; attempt++) {
    try {
      metrics.ytRequests++
      const headers = config.youtubeReferer ? { Referer: config.youtubeReferer } : {}
    const { res, json } = await once(url.toString(), headers)
      if (!res.ok) {
        const reason =
          (json && json.error && json.error.errors && json.error.errors[0] && json.error.errors[0].reason) ||
          (json && json.error && json.error.status) ||
          ''
        const detail =
          json && json.error && typeof json.error.message === 'string' ? json.error.message : ''
        const error = classify(res, reason, detail)
        if (error.code === 'quota') metrics.quotaErrors++
        metrics.ytErrors++
        if (error.code === 'quota' || error.code === 'invalid' || error.code === 'key_restricted') throw error
        lastError = error
      } else {
        if (!json || typeof json !== 'object') {
          throw new ApiError('YouTube sent an unexpected response.', 502, 'upstream')
        }
        recordQuota(cost)
        return json
      }
    } catch (err) {
      if (
        err instanceof ApiError &&
        (err.code === 'quota' || err.code === 'invalid' || err.code === 'key_restricted' || err.code === 'timeout')
      ) {
        if (err.code !== 'timeout') throw err
        lastError = err
      } else {
        lastError = err
        metrics.ytErrors++
      }
    }
    if (attempt < config.upstream.maxRetries) {
      await sleep(300 * 2 ** attempt + jitter())
    }
  }
  throw lastError instanceof ApiError
    ? lastError
    : new ApiError('YouTube is temporarily unavailable. Please try again.', 502, 'upstream')
}

/* ---------------------------- normalisation ---------------------------- */

function decode(s) {
  return String(s || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

function isoToSeconds(iso) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(iso || ''))
  if (!m) return 0
  return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)
}

function thumb(thumbs) {
  if (!thumbs || typeof thumbs !== 'object') return ''
  for (const size of ['maxres', 'standard', 'high', 'medium', 'default']) {
    const t = thumbs[size]
    if (t && typeof t.url === 'string' && /^https:\/\//i.test(t.url)) return t.url
  }
  return ''
}

const ID_RE = /^[A-Za-z0-9_-]{11}$/

function videoToTrack(video) {
  if (!video || typeof video !== 'object') return null
  const id = String((video.id && video.id.videoId) || video.id || '')
  if (!ID_RE.test(id)) return null
  const status = video.status || {}
  if (status.privacyStatus && status.privacyStatus !== 'public') return null
  if (status.embeddable === false) return null
  const live = video.snippet && video.snippet.liveBroadcastContent
  if (live === 'live' || live === 'upcoming') return null
  const title = decode(video.snippet && video.snippet.title).trim()
  if (!title) return null
  return {
    provider: 'youtube',
    external_id: id,
    title: title.slice(0, 150),
    artist: String(decode(video.snippet && video.snippet.channelTitle).trim() || 'Unknown artist').slice(0, 150),
    artist_id: String((video.snippet && video.snippet.channelId) || '').slice(0, 64),
    cover: thumb(video.snippet && video.snippet.thumbnails),
    category_id: String(video.categoryId || (video.snippet && video.snippet.categoryId) || ''),
    mirrors: [],
    duration: isoToSeconds(video.contentDetails && video.contentDetails.duration),
    genre: '',
    plays: 0,
    streamable: true,
    url: `https://www.youtube.com/watch?v=${id}`,
  }
}

export function normalizeVideos(items) {
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

export function channelToArtist(channel) {
  if (!channel || typeof channel !== 'object') return null
  const id = String(channel.id || '')
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null
  const sn = channel.snippet || {}
  const stats = channel.statistics || {}
  const name = decode(sn.title).trim()
  if (!name) return null
  const count = (v) => {
    const n = Number(v)
    return Number.isFinite(n) && v !== undefined && v !== null && v !== '' ? Math.max(0, n) : null
  }
  return {
    id,
    name: name.slice(0, 150),
    handle: String(decode(sn.customUrl).trim()).slice(0, 100),
    avatar: thumb(sn.thumbnails),
    track_count: count(stats.videoCount),
    follower_count: stats.hiddenSubscriberCount ? null : count(stats.subscriberCount),
  }
}

/* -------------------------- music classification ------------------------ */

/* Music-related words are deliberately broad: live/cover/acoustic/remix etc.
   are legitimate music, not noise. We only reject clearly unrelated content
   when it carries no music signal at all. */
const MUSIC_SIGNALS =
  /\b(music|song|songs|audio|lyrics?|live|acoustic|cover|remix|instrumental|concert|performance|mix|mixing|dj|karaoke|compilation|official\s*video|mv|band|track|single|album|feat|ft|radio|edit|version|session|symphony|orchestra|piano|guitar|hip\s*hop|rap|jazz|rock|pop|edm|r&b|soul)\b/i
const NON_MUSIC_SIGNALS =
  /\b(gameplay|trailer|tutorial|vlog|podcast|news|unboxing|documentary|interview|comedy|prank|how\s+to|walkthrough|review|reaction)\b/i
const MUSIC_CHANNEL =
  /(vevo|records|music|audio|lyrics|official|band|subject|entertainment|soundtrack|songs)/i

/** True when a video looks like music content. Never rejects on title alone. */
export function isMusicRelated(video) {
  const sn = (video && video.snippet) || {}
  const hay = [
    sn.title,
    sn.description,
    sn.channelTitle,
    Array.isArray(sn.tags) ? sn.tags.join(' ') : '',
  ]
    .filter(Boolean)
    .join(' ')
  /* videos.list carries categoryId at the top level; search results do not. */
  const categoryId = String((video && video.categoryId) || sn.categoryId || '')
  if (categoryId === '10') return true
  const topic = JSON.stringify((video && video.topicDetails) || {})
  if (/"\/m\/04rlf"|Music/.test(topic)) return true
  if (MUSIC_SIGNALS.test(hay)) return true
  if (MUSIC_CHANNEL.test(String(sn.channelTitle || ''))) return true
  if (NON_MUSIC_SIGNALS.test(hay)) return false
  /* No decisive signal: keep it. The query itself was music-oriented and
     aggressive keyword filters would drop genuine, oddly-tagged music. */
  return true
}

/* ------------------------------ endpoints ------------------------------ */

export async function videoDetails(ids) {
  const key = `videos:${ids.join(',')}`
  const hit = await cacheGet(key)
  if (hit) return hit
  return dedupe(key, async () => {
    const again = await cacheGet(key)
    if (again) return again
    const json = await ytGet('videos', { part: 'snippet,contentDetails,status', id: ids.join(',') }, 1)
    const list = json.items || []
    await cacheSet(key, list, config.cache.videoTtl)
    return list
  })
}

const MUSIC_TOPIC_ID = '/m/04rlf' // Freebase "Music"

/**
 * Music search with a conservative fallback.
 * Category 10 / music topic are preferred, but never used as the only source:
 * legitimate music is often miscategorised. The fallback is one extra search
 * and only runs when the strict search returned too few results.
 */
export async function searchVideos(query, { allowFallback = true } = {}) {
  const base = {
    part: 'snippet',
    type: 'video',
    videoEmbeddable: 'true',
    videoDuration: 'any',
    safeSearch: 'moderate',
    maxResults: '25',
    q: query,
  }
  metrics.lastSearchParams = {
    type: base.type,
    videoEmbeddable: base.videoEmbeddable,
    videoDuration: base.videoDuration,
    videoCategoryId: '10',
    safeSearch: base.safeSearch,
    maxResults: base.maxResults,
  }
  const primary = await ytGet('search', { ...base, videoCategoryId: '10' }, 100)
  let items = (primary.items || []).filter((i) => i && i.id && i.id.videoId)

  if (allowFallback && items.length < 4) {
    let fallback = null
    try {
      fallback = await ytGet('search', { ...base, topicId: MUSIC_TOPIC_ID }, 100)
    } catch (err) {
      /* Quota / invalid requests must not be retried via another search. */
      if (err instanceof ApiError && (err.code === 'quota' || err.code === 'invalid')) throw err
      fallback = null
    }
    if (fallback && Array.isArray(fallback.items)) {
      const seen = new Set(items.map((i) => i.id.videoId))
      for (const item of fallback.items) {
        if (!item || !item.id || !item.id.videoId || seen.has(item.id.videoId)) continue
        seen.add(item.id.videoId)
        items.push(item)
      }
    }
  }
  return items
}

export async function artistVideos(channelId) {
  const json = await ytGet(
    'search',
    { part: 'snippet', type: 'video', videoEmbeddable: 'true', channelId, maxResults: '30' },
    100
  )
  return (json.items || []).filter((i) => i.id && i.id.videoId)
}

export async function chart(pageToken = '') {
  const json = await ytGet(
    'videos',
    { part: 'snippet,contentDetails,status', chart: 'mostPopular', videoCategoryId: '10', maxResults: '50', pageToken },
    1
  )
  return { items: json.items || [], nextPageToken: String(json.nextPageToken || '') }
}

export async function channels(ids) {
  return ytGet('channels', { part: 'snippet,statistics', id: ids.join(',') }, 1)
}
