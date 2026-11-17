/**
 * Operational counters (no keys, tokens or personal data). Useful for watching
 * rate-limited requests, cache hit rate and YouTube API errors.
 */
import { metricsSnapshot } from './_lib/store.js'

export default function handler(req, res) {
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify({ ok: true, ...metricsSnapshot() }))
}
