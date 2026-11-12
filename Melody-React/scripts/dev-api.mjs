/**
 * Local development server for the /api functions (port 3100).
 *
 * Vercel runs api/*.js as serverless functions; locally `npm run dev:api`
 * runs the very same handlers behind a tiny adapter, and vite.config.js
 * proxies /api to it. Credentials are read from the .env file at the project
 * root (never committed - see .env.example).
 *
 *   npm run dev        -> Vite on 5173 (proxies /api here)
 *   npm run dev:api    -> this file on 3100
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import audiusHandler from '../api/audius.js'
import streamHandler from '../api/stream.js'

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

/* --------------------------- Vercel-style adapter ------------------------ */

function adapt(req, res, query) {
  const outgoing = {
    method: req.method,
    headers: req.headers,
    query,
    setHeader: (name, value) => res.setHeader(name, value),
    status(code) {
      res.statusCode = code
      return outgoing
    },
    json(body) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify(body))
      return outgoing
    },
    end(data) {
      res.end(data)
      return outgoing
    },
  }
  return outgoing
}

async function run(handler, req, res, query) {
  const vres = adapt(req, res, query) // one object: readable like req, writable like res
  try {
    await handler(vres, vres)
  } catch (err) {
    if (!res.headersSent) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end('Something went wrong on the server.')
    }
    console.error('[dev-api]', err)
  }
}

/* -------------------------------- server --------------------------------- */

async function main() {
  await loadEnv()

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`)

    if (url.pathname === '/api/audius') {
      const query = Object.fromEntries(url.searchParams.entries())
      await run(audiusHandler, req, res, query)
      return
    }

    if (url.pathname === '/api/stream') {
      const query = Object.fromEntries(url.searchParams.entries())
      await run(streamHandler, req, res, query)
      return
    }

    if (url.pathname === '/api/health') {
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ ok: true }))
      return
    }

    res.statusCode = 404
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.end('Not found.')
  })

  server.listen(PORT, '127.0.0.1', () => {
    const supabase = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    console.log(`[dev-api] listening on http://127.0.0.1:${PORT}`)
    console.log(`[dev-api] Audius credentials: ${process.env.AUDIUS_BEARER_TOKEN || process.env.AUDIUS_API_KEY ? 'configured' : 'none (keyless)'}`)
    console.log(`[dev-api] Supabase: ${supabase ? 'configured' : 'not configured (auth/DB will fail until .env is filled in)'}`)
  })
}

main()
