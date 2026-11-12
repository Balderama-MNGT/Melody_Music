/**
 * Client access to Melody's own serverless functions.
 *
 * The Audius credentials live only in the server environment
 * (AUDIUS_API_KEY / AUDIUS_BEARER_TOKEN / AUDIUS_APP_NAME) - this module
 * never touches them. Every call carries the user's Supabase access token so
 * the functions can enforce "logged in", exactly like the PHP proxy did.
 */
import { supabase, requireSupabase } from './supabase.js'

async function accessToken() {
  const db = requireSupabase()
  const { data } = await db.auth.getSession()
  return data?.session?.access_token || ''
}

async function authHeader() {
  const token = await accessToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/** GET /api/audius?action=... -> resolved payload ({ ok, tracks|artists, ... }). */
export async function audiusRequest(params) {
  const headers = { Accept: 'application/json', ...(await authHeader()) }
  const qs = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)

  let res
  try {
    res = await fetch(`/api/audius?${qs.toString()}`, { headers, signal: controller.signal })
  } catch (err) {
    clearTimeout(timer)
    if (err && err.name === 'AbortError') {
      throw new Error('Audius took too long to respond. Please try again.')
    }
    throw new Error('Could not load tracks. Check your connection and try again.')
  } finally {
    clearTimeout(timer)
  }

  let data = null
  try {
    data = await res.json()
  } catch {
    data = null
  }

  if (res.status === 401) {
    const err = new Error('Your session has expired. Please log in again.')
    err.status = 401
    throw err
  }
  if (!data || !data.ok) {
    const err = new Error(
      (data && data.error) || `Melody could not load Audius tracks (HTTP ${res.status}).`
    )
    err.status = res.status
    err.debug = data && data.debug
    throw err
  }
  return data
}

/**
 * The playable URL for one Audius track.
 *
 * The <audio> element cannot carry an Authorization header, so we ask our
 * own function (with the session token) for the final media URL first and
 * hand that to the audio element. Range requests and seeking still work
 * because the media URL itself is Range-capable; no credential ever appears
 * in the URL.
 */
export async function resolveStreamUrl(externalId) {
  const headers = { Accept: 'application/json', ...(await authHeader()) }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)

  let res
  try {
    res = await fetch(`/api/stream?id=${encodeURIComponent(externalId)}`, {
      headers,
      signal: controller.signal,
    })
  } catch (err) {
    clearTimeout(timer)
    if (err && err.name === 'AbortError') {
      throw new Error('The streaming service took too long to respond.')
    }
    throw new Error('Could not reach the streaming service. Check your connection and try again.')
  } finally {
    clearTimeout(timer)
  }

  const raw = await res.text().catch(() => '')
  let data = null
  try {
    data = raw ? JSON.parse(raw) : null
  } catch {
    data = null
  }

  if (res.status === 401) {
    const err = new Error('Your session has expired. Please log in again.')
    err.status = 401
    throw err
  }
  if (!data || !data.ok || !data.url) {
    const err = new Error(
      (data && data.error) || (raw && raw.slice(0, 200)) || `Melody could not load this track (HTTP ${res.status}).`
    )
    err.status = res.status
    throw err
  }
  return data.url
}
