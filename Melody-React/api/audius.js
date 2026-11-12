/**
 * GET /api/audius?action=…   - JSON proxy for Audius trending, discovery,
 * artists + search. Port of Melody/api/audius.php.
 *
 *   ?action=trending[&time=week|month|allTime][&genre=..][&limit=..][&offset=..]
 *   ?action=discover[&limit=..]                 (chart tracks minus trending)
 *   ?action=artists[&limit=..]                  (real artists from live charts)
 *   ?action=artist_tracks&id=USER_ID[&limit=..] (one artist's catalog)
 *   ?action=search&q=...[&limit=..]
 *
 * Requires a valid Supabase session token; credentials stay on the server so
 * the browser only ever sees track/artist data.
 */
import {
  AudiusError,
  audiusArtistTracks,
  audiusArtists,
  audiusDiscover,
  audiusSearch,
  audiusTrending,
} from '../server/audius.mjs'
import { isLocalRequest, requireUser } from '../server/auth.mjs'

function send(res, status, body, extraHeaders = {}) {
  for (const [name, value] of Object.entries(extraHeaders)) res.setHeader(name, value)
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.status(status)
  return res.json(body)
}

export default async function handler(req, res) {
  if (req.method && req.method !== 'GET') {
    return send(res, 405, { ok: false, error: 'Method not allowed.' })
  }

  const user = await requireUser(req)
  if (!user) return send(res, 401, { ok: false, error: 'Please log in.' })

  const q = req.query || {}
  const action = String(q.action || '')
  const limit = parseInt(q.limit, 10) || 24
  const debug = isLocalRequest(req)

  try {
    if (action === 'trending') {
      const tracks = await audiusTrending({
        limit,
        time: String(q.time || 'week'),
        genre: String(q.genre || ''),
        offset: parseInt(q.offset, 10) || 0,
      })
      return send(res, 200, { ok: true, count: tracks.length, tracks })
    }

    if (action === 'discover') {
      const tracks = await audiusDiscover(limit)
      return send(res, 200, { ok: true, count: tracks.length, tracks })
    }

    if (action === 'artists') {
      const artists = await audiusArtists(limit)
      return send(res, 200, { ok: true, count: artists.length, artists })
    }

    if (action === 'artist_tracks') {
      const tracks = await audiusArtistTracks(String(q.id || ''), limit)
      return send(res, 200, { ok: true, count: tracks.length, tracks })
    }

    if (action === 'search') {
      const query = String(q.q || '').slice(0, 100)
      if (!query) return send(res, 400, { ok: false, error: 'Please enter a search term.' })
      const tracks = await audiusSearch(query, limit)
      return send(res, 200, { ok: true, count: tracks.length, tracks, query })
    }

    return send(res, 400, { ok: false, error: 'Unknown action.' })
  } catch (err) {
    if (err instanceof AudiusError) {
      const body = { ok: false, error: err.message }
      if (debug && err.debug) body.debug = err.debug
      return send(res, err.status || 502, body)
    }
    return send(res, 500, { ok: false, error: 'Something went wrong on the server.' })
  }
}
