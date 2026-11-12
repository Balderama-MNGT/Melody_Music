/**
 * GET /api/stream?id=TRACK_ID - resolves the playable Audius URL as JSON.
 * Port of Melody/api/audius_stream.php (which 302-redirected, because there
 * the session lived in a cookie the <audio> tag sent automatically).
 *
 * Here the session is a bearer token, and an <audio> element cannot set
 * headers - so the player calls this endpoint WITH its token, receives
 * { ok, url } and points the audio element straight at the Range-capable
 * media node (seeking works, nothing is buffered by us). No API credential
 * is ever sent to the browser or to the media node.
 * Requires a valid Supabase session token.
 */
import { AudiusError, audiusResolveStreamUrl, isValidTrackId } from '../server/audius.mjs'
import { isLocalRequest, requireUser } from '../server/auth.mjs'

function text(res, status, message) {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.status(status)
  return res.end(message)
}

export default async function handler(req, res) {
  if (req.method && req.method !== 'GET') return text(res, 405, 'Method not allowed.')

  const user = await requireUser(req)
  if (!user) return text(res, 401, 'Please log in.')

  const id = String((req.query && req.query.id) || '')
  if (!isValidTrackId(id)) return text(res, 400, 'Invalid track.')

  try {
    const url = await audiusResolveStreamUrl(id)
    res.setHeader('Cache-Control', 'private, max-age=180')
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.status(200)
    return res.json({ ok: true, url })
  } catch (err) {
    if (err instanceof AudiusError) {
      let detail = ''
      if (isLocalRequest(req) && err.debug) detail = `\n\n[debug] ${JSON.stringify(err.debug)}`
      return text(res, err.status || 502, `${err.message}${detail}`)
    }
    return text(res, 500, 'Something went wrong while loading this track.')
  }
}
