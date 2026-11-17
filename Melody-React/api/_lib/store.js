/**
 * Shared cache / rate-limit primitives.
 *
 * L1 is always process memory. When UPSTASH_REDIS_REST_URL + TOKEN are set,
 * cache entries and rate-limit counters live in Redis via its REST API (no new
 * npm dependency), so multiple serverless instances share the same budget.
 * Never stores keys, tokens, or user data - only cache values and counters.
 */
import { config } from './config.js'

const sharedEnabled = Boolean(config.shared.url && config.shared.token)
const cache = new Map()
const inflight = new Map()
const windows = new Map()
const quota = { day: '', used: 0 }

export const metrics = {
  requests: 0,
  limited: 0,
  invalid: 0,
  ytRequests: 0,
  ytErrors: 0,
  quotaErrors: 0,
  cacheHits: 0,
  cacheMisses: 0,
  sharedErrors: 0,
  lastSearchParams: null,
  totalMs: 0,
  measured: 0,
  byAction: {},
}

async function redis(...args) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2000)
  try {
    const res = await fetch(config.shared.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.shared.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`shared store ${res.status}`)
    const json = await res.json()
    return json && json.result
  } finally {
    clearTimeout(timer)
  }
}

export async function cacheGet(key) {
  if (sharedEnabled) {
    try {
      const raw = await redis('GET', `melody:cache:${key}`)
      if (raw) {
        metrics.cacheHits++
        return JSON.parse(raw)
      }
    } catch {
      metrics.sharedErrors++
    }
  }
  const hit = cache.get(key)
  if (hit && hit.expires > Date.now()) {
    metrics.cacheHits++
    return hit.value
  }
  if (hit) cache.delete(key)
  metrics.cacheMisses++
  return null
}

export async function cacheSet(key, value, ttlMs) {
  if (ttlMs <= 0) return
  cache.set(key, { value, expires: Date.now() + ttlMs })
  if (cache.size > config.cache.maxEntries) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
  if (sharedEnabled) {
    try {
      await redis(
        'SET',
        `melody:cache:${key}`,
        JSON.stringify(value),
        'EX',
        Math.max(1, Math.ceil(ttlMs / 1000))
      )
    } catch {
      metrics.sharedErrors++
    }
  }
}

/** Run one request per key at a time, even under a burst of duplicate calls. */
export function dedupe(key, fn) {
  if (inflight.has(key)) return inflight.get(key)
  const promise = Promise.resolve()
    .then(fn)
    .finally(() => inflight.delete(key))
  inflight.set(key, promise)
  return promise
}

export async function rateCheck(key, limit, windowMs) {
  if (sharedEnabled) {
    try {
      const rk = `melody:rl:${key}`
      const count = Number(await redis('INCR', rk))
      if (count === 1) await redis('EXPIRE', rk, Math.max(1, Math.ceil(windowMs / 1000)))
      const ttl = Number(await redis('TTL', rk))
      return {
        allowed: count <= limit,
        remaining: Math.max(0, limit - count),
        retryAfter: Math.max(1, Number.isFinite(ttl) && ttl > 0 ? ttl : Math.ceil(windowMs / 1000)),
      }
    } catch {
      metrics.sharedErrors++
      /* fall through to local counters */
    }
  }

  const now = Date.now()
  const hits = windows.get(key) || []
  while (hits.length && hits[0] <= now - windowMs) hits.shift()
  const allowed = hits.length < limit
  if (allowed) hits.push(now)
  windows.set(key, hits)
  if (windows.size > 5000) {
    for (const [k, v] of windows) if (!v.length) windows.delete(k)
  }
  return {
    allowed,
    remaining: Math.max(0, limit - hits.length),
    retryAfter: hits.length ? Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000)) : Math.ceil(windowMs / 1000),
  }
}

const today = () => new Date().toISOString().slice(0, 10)
const quotaKey = (day) => `melody:quota:${day}`

export function recordQuota(cost) {
  const day = today()
  if (quota.day !== day) {
    quota.day = day
    quota.used = 0
  }
  quota.used += cost
  if (sharedEnabled && cost > 0) {
    /* Also account for the spend in the shared store so several API instances
       cannot each believe they still have the full daily YouTube quota. */
    redis(['INCRBY', quotaKey(day), cost], ['EXPIRE', quotaKey(day), 172_800])
      .catch(() => { metrics.sharedErrors++ })
  }
}

/** Local view (used by /api/metrics) - no network call. */
export function quotaStatus() {
  recordQuota(0)
  return { day: quota.day, used: quota.used, dailyLimit: config.quota.daily }
}

/** Shared view used before a YouTube call. Falls back to local memory. */
export async function quotaStatusShared() {
  if (sharedEnabled) {
    try {
      const day = today()
      const used = Number(await redis('GET', quotaKey(day))) || 0
      return { day, used, dailyLimit: config.quota.daily }
    } catch {
      metrics.sharedErrors++
    }
  }
  return quotaStatus()
}

export function metricsSnapshot() {
  return {
    ...metrics,
    avgMs: metrics.measured ? Math.round(metrics.totalMs / metrics.measured) : 0,
    sharedCache: sharedEnabled,
    quota: quotaStatus(),
    uptime: Math.floor(process.uptime()),
  }
}
