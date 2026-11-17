/**
 * Protected play-recording endpoint.
 * Identity comes from the verified Supabase token - never from client data.
 * Duplicate protection: a client-generated session UUID plus a UNIQUE database
 * constraint on (user_id, play_session_id) (see supabase_schema.sql).
 */
import { config } from './config.js'
import { json, originAllowed, verifiedUserId } from './handler.js'
import { metrics, rateCheck } from './store.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/

function text(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max)
}

async function readBody(req) {
  /* Vercel may hand us a pre-parsed body; dev's node:http gives a stream. */
  if (req.body && typeof req.body === 'object') return req.body
  if (req.body && typeof req.body === 'string') return JSON.parse(req.body)
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 4096) throw new Error('too_large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

export async function handlePlays(req, res) {
  const headers = {
    'Access-Control-Allow-Origin': originAllowed(req) ? String(req.headers.origin || '*') : 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Max-Age': '600',
  }
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)

  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Method not allowed.' })
  if (!originAllowed(req)) return json(res, 403, { ok: false, error: 'Origin not allowed.' })

  const userId = await verifiedUserId(req)
  if (!userId) {
    return json(res, 401, { ok: false, error: 'Sign in to save your listening history.', code: 'unauthorized' })
  }

  const limited = await rateCheck(`plays:${userId}`, config.plays.maxPerMinute, config.limits.windowMs)
  if (!limited.allowed) {
    metrics.limited++
    return json(
      res,
      429,
      { ok: false, error: 'Too many play records. Please slow down.', code: 'rate_limited' },
      { 'Retry-After': String(limited.retryAfter) }
    )
  }

  let body
  try {
    body = await readBody(req)
  } catch {
    return json(res, 400, { ok: false, error: 'Invalid play record.', code: 'invalid' })
  }

  const sessionId = String(body.sessionId || '')
  const listenedMs = Number(body.listenedMs)
  const t = body.track || {}
  const externalId = String(t.external_id || '')

  if (!UUID_RE.test(sessionId) || !VIDEO_ID_RE.test(externalId)) {
    return json(res, 400, { ok: false, error: 'Invalid play record.', code: 'invalid' })
  }
  if (!Number.isFinite(listenedMs) || listenedMs < config.plays.minListenMs) {
    return json(res, 400, { ok: false, error: 'The song was not played long enough to count.', code: 'too_short' })
  }
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    return json(res, 503, { ok: false, error: 'Listening history is not configured.', code: 'not_configured' })
  }

  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const row = {
    user_id: userId,
    play_session_id: sessionId,
    external_id: externalId,
    title: text(t.title, 150) || 'Untitled',
    artist: text(t.artist, 150) || 'Unknown artist',
    cover: text(t.cover, 2000) || null,
    duration: Math.max(0, Math.min(86_400, Math.floor(Number(t.duration) || 0))),
    played_at: new Date().toISOString(),
  }

  /* No on_conflict: the UNIQUE index on (user_id, play_session_id) is partial,
     which Postgres does not accept as an ON CONFLICT target (42P10). Let the
     constraint reject duplicates; a 23505/409 is a successful no-op. */
  const url = new URL('/rest/v1/listening_history', config.supabaseUrl)

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    const res2 = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=minimal',
      },
      body: JSON.stringify(row),
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!res2.ok) {
      const detail = await res2.text().catch(() => '')
      let upstream = {}
      try {
        upstream = JSON.parse(detail)
      } catch {
        upstream = { message: String(detail || '').slice(0, 300) }
      }
      /* Postgres 23505 = unique violation = the same session was already
         recorded. That is the idempotent success case, not an error. */
      if (upstream.code === '23505' || res2.status === 409) {
        return json(res, 200, { ok: true, recorded: false, duplicate: true, sessionId })
      }
      console.error('[api/plays] Supabase insert failed', {
        status: res2.status,
        code: upstream.code || null,
        message: String(upstream.message || upstream.hint || '').slice(0, 300),
        sessionId,
        externalId,
      })
      if (/play_session_id/.test(detail)) {
        return json(res, 503, {
          ok: false,
          error: 'Listening history needs a database update before play records can be saved.',
          code: 'migration_required',
          upstream: { status: res2.status, code: upstream.code || null, message: String(upstream.message || '').slice(0, 200) },
        })
      }
      return json(res, 502, {
        ok: false,
        error: 'Could not save this play right now.',
        code: 'database',
        upstream: { status: res2.status, code: upstream.code || null, message: String(upstream.message || '').slice(0, 200) },
      })
    }
    return json(res, 200, { ok: true, recorded: true, sessionId })
  } catch (err) {
    console.error('[api/plays] play recording request failed', {
      reason: err && err.name === 'AbortError' ? 'timeout' : 'network',
      sessionId,
      externalId,
    })
    return json(res, 504, { ok: false, error: 'Listening history took too long to respond.', code: 'timeout' })
  }
}
