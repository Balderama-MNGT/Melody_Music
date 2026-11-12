/**
 * Verifies that a request really comes from a signed-in Melody user.
 *
 * The browser sends the Supabase access token as `Authorization: Bearer …`;
 * here it is checked against Supabase's own /auth/v1/user endpoint. Only the
 * PUBLIC anon key is used (never service_role), so nothing secret can leak.
 * Every table is additionally protected by Row Level Security on the SQL side.
 */

function supabaseUrl() {
  const v = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
  return String(v).trim().replace(/\/+$/, '')
}

function anonKey() {
  return String(process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '').trim()
}

function bearerToken(req) {
  const headers = (req && req.headers) || {}
  const raw = headers.authorization || headers.Authorization || ''
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return ''
  return value.startsWith('Bearer ') ? value.slice(7).trim() : ''
}

/**
 * @returns {Promise<object|null>} the Supabase user, or null when the token
 * is missing/invalid or Supabase is not configured.
 */
export async function requireUser(req) {
  const token = bearerToken(req)
  const url = supabaseUrl()
  const key = anonKey()
  if (!token || !url || !key) return null

  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const user = await res.json()
    return user && user.id ? user : null
  } catch {
    return null
  }
}

/** Localhost only: technical detail for the developer (never for visitors). */
export function isLocalRequest(req) {
  const headers = (req && req.headers) || {}
  const host = String(headers['x-forwarded-host'] || headers.host || '').toLowerCase()
  const proto = String(headers['x-forwarded-proto'] || 'https').toLowerCase()
  if (proto === 'http') return true
  return /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host)
}
