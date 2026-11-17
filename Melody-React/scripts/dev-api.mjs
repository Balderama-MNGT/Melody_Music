/**
 * Local development helper (port 3100): a tiny server that answers
 * GET /api/health so the dev proxy and health checks have something to hit.
 *
 * Since the Audius migration the music search talks to YouTube directly from
 * the browser (see src/lib/api.js), so no /api music routes remain and the
 * app itself never calls this server. Credentials are read from the .env file
 * at the project root (never committed - see .env.example).
 *
 *   npm run dev        -> Vite on 5173 (proxies /api here)
 *   npm run dev:api    -> this file on 3100
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.API_PORT || 3100)

/* ------------------------------ .env loading ----------------------------- */

async function loadEnv() {
  try {
    const raw = await readFile(join(ROOT, '.env'), 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq < 1) continue
      const key = trimmed.slice(0, eq).trim()
      let value = trimmed.slice(eq + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
        (value.startsWith("'") && value.endsWith("'") && value.length > 1)
      ) {
        value = value.slice(1, -1)
      }
      if (!(key in process.env)) process.env[key] = value
    }
  } catch {
    /* no .env yet: the API works keyless, only Supabase features need it */
  }
}

/* -------------------------------- server --------------------------------- */

async function main() {
  await loadEnv()

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`)

    if (url.pathname === '/api/health') {
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ ok: true }))
      return
    }

    if (url.pathname === '/api/music') {
      const { handleMusic } = await import('../api/_lib/handler.js')
      return handleMusic(req, res)
    }

    if (url.pathname === '/api/plays') {
      const { handlePlays } = await import('../api/_lib/plays.js')
      return handlePlays(req, res)
    }

    if (url.pathname === '/api/metrics') {
      const { metricsSnapshot } = await import('../api/_lib/store.js')
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ ok: true, ...metricsSnapshot() }))
      return
    }

    res.statusCode = 404
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.end('Not found.')
  })

  server.listen(PORT, '127.0.0.1', () => {
    const supabase = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    console.log(`[dev-api] listening on http://127.0.0.1:${PORT}`)
    console.log(`[dev-api] YouTube Data API: ${process.env.YOUTUBE_API_KEY ? 'server-side key configured' : 'NO server key (set YOUTUBE_API_KEY in .env)'}`)
    console.log(`[dev-api] Supabase: ${supabase ? 'configured' : 'not configured (auth/DB will fail until .env is filled in)'}`)
  })
}

main()
