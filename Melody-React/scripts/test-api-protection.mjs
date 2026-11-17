/**
 * Automated checks for the backend protection layer.
 * Run: node scripts/test-api-protection.mjs
 * Uses tiny in-process limits and a temporary dev-api child - no YouTube key
 * or quota is needed, and no credentials are printed.
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -> ${detail}` : ''}`)
}

/* ------------------- in-process primitives ------------------- */
process.env.RATE_LIMIT_WINDOW_MS = '1000'
process.env.RATE_LIMIT_IP_MAX = '2'
process.env.CACHE_MAX_ENTRIES = '50'

const { rateCheck, cacheGet, cacheSet, dedupe, metricsSnapshot } = await import(
  new URL('../api/_lib/store.js', import.meta.url)
)
const { config } = await import(new URL('../api/_lib/config.js', import.meta.url))
const { classify } = await import(new URL('../api/_lib/youtube.js', import.meta.url))

check(
  'server key is read from process.env.YOUTUBE_API_KEY (no VITE_ key)',
  !('VITE_YOUTUBE_API_KEY' in process.env) || config.youtubeKey !== process.env.VITE_YOUTUBE_API_KEY,
  `configured=${Boolean(config.youtubeKey)}`
)
check(
  'a referrer fallback is configured for deployed server-side calls',
  /^https:\/\//.test(config.youtubeReferer),
  config.youtubeReferer
)
const denied = classify({ status: 403 }, 'forbidden', 'Permission denied on the service.')
check(
  'HTTP 403 forbidden is reported as a key restriction, not a generic empty result',
  denied.code === 'key_restricted' && /restriction/i.test(denied.message),
  `${denied.code}: ${denied.message}`
)

const a = await rateCheck('test-ip', 2, 1000)
const b = await rateCheck('test-ip', 2, 1000)
const c = await rateCheck('test-ip', 2, 1000)
check('rate limiter allows up to the limit', a.allowed && b.allowed, `${a.remaining} -> ${b.remaining}`)
check('rate limiter blocks the next request', !c.allowed && c.retryAfter > 0, `retryAfter=${c.retryAfter}`)

await cacheSet('test-key', { hello: 'world' }, 200)
check('cache returns a stored value', (await cacheGet('test-key'))?.hello === 'world')
await new Promise((r) => setTimeout(r, 260))
check('cache expires on TTL', (await cacheGet('test-key')) === null)

let calls = 0
const work = () => new Promise((resolve) => setTimeout(() => { calls++; resolve(calls) }, 30))
const [x, y, z] = await Promise.all([dedupe('k', work), dedupe('k', work), dedupe('k', work)])
check('dedupe collapses concurrent duplicates', calls === 1 && x === y && y === z, `calls=${calls}`)

/* ------------------- end-to-end 429 + Retry-After ------------------- */
const PORT = 3199
const child = spawn(process.execPath, ['scripts/dev-api.mjs'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: {
    ...process.env,
    API_PORT: String(PORT),
    RATE_LIMIT_WINDOW_MS: '60_000',
    RATE_LIMIT_IP_MAX: '2',
    RATE_LIMIT_SEARCH_IP_MAX: '2',
    YOUTUBE_API_KEY: '',
  },
  stdio: 'ignore',
})
try {
  let ready = false
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 150))
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/health`)
      if (res.ok) { ready = true; break }
    } catch { /* not up yet */ }
  }
  check('temporary API server started', ready)

  if (ready) {
    const call = () => fetch(`http://127.0.0.1:${PORT}/api/music?action=search&q=test`)
    const r1 = await call()
    const r2 = await call()
    const r3 = await call()
    check('normal requests pass the limiter', r1.status !== 429 && r2.status !== 429, `${r1.status}, ${r2.status}`)
    check('excess request gets HTTP 429', r3.status === 429, `status=${r3.status}`)
    check('429 includes Retry-After', Number(r3.headers.get('retry-after')) > 0, `retry-after=${r3.headers.get('retry-after')}`)

    const bad = await fetch(`http://127.0.0.1:${PORT}/api/music?action=nope`)
    check('invalid actions are rejected', bad.status === 400, `status=${bad.status}`)
  }
} finally {
  child.kill()
}

/* ---------------- per-endpoint budgets (search vs cheap actions) ---------- */
const EPORT = 3201
const endpointChild = spawn(process.execPath, ['scripts/dev-api.mjs'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: {
    ...process.env,
    API_PORT: String(EPORT),
    RATE_LIMIT_WINDOW_MS: '60_000',
    RATE_LIMIT_IP_MAX: '6',
    RATE_LIMIT_SEARCH_IP_MAX: '2',
    YOUTUBE_API_KEY: '',
  },
  stdio: 'ignore',
})
try {
  let ready = false
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 150))
    try {
      if ((await fetch(`http://127.0.0.1:${EPORT}/api/health`)).ok) { ready = true; break }
    } catch { /* not up yet */ }
  }
  check('endpoint-budget API server started', ready)
  if (ready) {
    const statuses = []
    for (let i = 0; i < 3; i++) {
      const r = await fetch(`http://127.0.0.1:${EPORT}/api/music?action=search&q=endpoint`)
      statuses.push(r.status)
    }
    check('search has its own stricter budget', statuses[2] === 429, statuses.join(','))
    const cheap = []
    for (let i = 0; i < 5; i++) {
      const r = await fetch(`http://127.0.0.1:${EPORT}/api/music?action=trending`)
      cheap.push(r.status)
    }
    check('cheap cached actions are not blocked by the search budget',
      cheap.every((s) => s !== 429), cheap.join(','))
  }
} finally {
  endpointChild.kill()
}

const snapshot = metricsSnapshot()
check('metrics expose cache counters', typeof snapshot.cacheHits === 'number' && typeof snapshot.ytRequests === 'number')

/* ------------------- quota guard (no real key or quota used) ------------------- */
const QPORT = 3200
const quotaChild = spawn(process.execPath, ['scripts/dev-api.mjs'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: {
    ...process.env,
    API_PORT: String(QPORT),
    YOUTUBE_API_KEY: 'test-key-not-real',
    YOUTUBE_QUOTA_DAILY: '1',
    YOUTUBE_REFERER: '',
  },
  stdio: 'ignore',
})
try {
  let ready = false
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 150))
    try {
      if ((await fetch(`http://127.0.0.1:${QPORT}/api/health`)).ok) { ready = true; break }
    } catch { /* not up yet */ }
  }
  check('quota-test API server started', ready)
  if (ready) {
    const res = await fetch(`http://127.0.0.1:${QPORT}/api/music?action=search&q=test`)
    const body = await res.json().catch(() => ({}))
    check('quota guard returns 503 before calling YouTube', res.status === 503 && body.code === 'quota', `status=${res.status} code=${body.code} error=${body.error}`)
  }
} finally {
  quotaChild.kill()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} protection checks passed`)
if (failed.length) process.exitCode = 1
