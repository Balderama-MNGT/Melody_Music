import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Melody - Vite config.
 *
 * /api/* is handled by Vercel serverless functions in production and by
 * `npm run dev:api` (scripts/dev-api.mjs) locally, so the dev server proxies
 * those paths to it. Everything else falls through to the SPA (index.html).
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3100',
        changeOrigin: false,
      },
    },
  },
})
