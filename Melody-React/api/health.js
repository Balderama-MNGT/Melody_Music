/**
 * Deployment health check. Reports configuration as booleans only - never the
 * API key or any other secret. Deployed at /api/health on Vercel.
 */
import { config } from './_lib/config.js'

export default function handler(req, res) {
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(
    JSON.stringify({
      ok: true,
      youtubeKeyConfigured: Boolean(config.youtubeKey),
      youtubeRefererConfigured: Boolean(config.youtubeReferer),
      allowedOrigins: config.allowedOrigins.length,
      youtubeQuotaDaily: config.quota.daily,
    })
  )
}
