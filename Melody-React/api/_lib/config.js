/**
 * Central configuration for the music API.
 * Every limit/TTL comes from environment variables with a sane local default;
 * nothing is hardcoded in the endpoint handlers.
 */

function num(name, fallback, min, max) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}

const origins = String(process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

export const config = {
  youtubeKey: String(process.env.YOUTUBE_API_KEY || '').trim(),
  /* Only needed while the existing key still uses an HTTP-referrer restriction
     (a server fetch normally has none). Remove once the key is restricted to
     this server's IP instead - see .env.example. */
  youtubeReferer: String(process.env.YOUTUBE_REFERER || '').trim(),
  supabaseUrl: String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim(),
  supabaseAnonKey: String(
    process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''
  ).trim(),

  allowedOrigins: origins.length
    ? origins
    : ['http://localhost:5173', 'https://melody-music-ten.vercel.app'],

  limits: {
    windowMs: num('RATE_LIMIT_WINDOW_MS', 60_000, 1_000, 3_600_000),
    /* Per-endpoint buckets. Search is the only action that can spend YouTube
       quota, so it gets its own (stricter) budget. Charts/cached lists and
       artist lookups are cheaper and must not share the search allowance. */
    ipMax: num('RATE_LIMIT_IP_MAX', 120, 1, 10_000),
    userMax: num('RATE_LIMIT_USER_MAX', 240, 1, 20_000),
    searchIpMax: num('RATE_LIMIT_SEARCH_IP_MAX', 30, 1, 1_000),
    searchUserMax: num('RATE_LIMIT_SEARCH_USER_MAX', 60, 1, 2_000),
    chartIpMax: num('RATE_LIMIT_CHART_IP_MAX', 120, 1, 10_000),
    chartUserMax: num('RATE_LIMIT_CHART_USER_MAX', 240, 1, 20_000),
    artistIpMax: num('RATE_LIMIT_ARTIST_IP_MAX', 60, 1, 10_000),
    artistUserMax: num('RATE_LIMIT_ARTIST_USER_MAX', 120, 1, 20_000),
  },

  cache: {
    /* Empty results get a much shorter TTL: a transient upstream failure or a
       quiet moment must not poison the cache for the full search TTL. */
    emptySearchTtl: num('CACHE_EMPTY_SEARCH_TTL_MS', 60_000, 0, 3_600_000),
    searchTtl: num('CACHE_SEARCH_TTL_MS', 900_000, 0, 86_400_000),
    videoTtl: num('CACHE_VIDEO_TTL_MS', 3_600_000, 0, 86_400_000),
    chartTtl: num('CACHE_CHART_TTL_MS', 600_000, 0, 86_400_000),
    artistTtl: num('CACHE_ARTIST_TTL_MS', 1_200_000, 0, 86_400_000),
    channelTtl: num('CACHE_CHANNEL_TTL_MS', 900_000, 0, 86_400_000),
    maxEntries: num('CACHE_MAX_ENTRIES', 500, 10, 50_000),
  },

  quota: {
    daily: num('YOUTUBE_QUOTA_DAILY', 10_000, 1, 1_000_000_000),
  },

  upstream: {
    timeoutMs: num('YOUTUBE_TIMEOUT_MS', 12_000, 1_000, 60_000),
    maxRetries: num('YOUTUBE_MAX_RETRIES', 2, 0, 5),
  },

  recommend: {
    ttl: num('RECOMMEND_CACHE_TTL_MS', 600_000, 0, 86_400_000),
    emptyTtl: num('RECOMMEND_EMPTY_TTL_MS', 60_000, 0, 3_600_000),
    maxQueries: num('RECOMMEND_MAX_QUERIES', 3, 1, 6),
    minResults: num('RECOMMEND_MIN_RESULTS', 6, 1, 50),
  },

  plays: {
    minListenMs: num('MIN_PLAY_MS', 3_000, 0, 600_000),
    maxPerMinute: num('PLAYS_LIMIT_PER_MINUTE', 20, 1, 500),
  },

  /* Optional shared store for multi-instance deployments (Upstash Redis REST).
     When unset, the API falls back to per-instance memory and the limitation is
     documented in .env.example. */
  shared: {
    url: String(process.env.UPSTASH_REDIS_REST_URL || '').trim(),
    token: String(process.env.UPSTASH_REDIS_REST_TOKEN || '').trim(),
  },
}
