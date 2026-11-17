/**
 * Vercel serverless entry point for all music data requests.
 * The YouTube API key stays server-side (process.env.YOUTUBE_API_KEY).
 */
import { handleMusic } from './_lib/handler.js'

export default async function handler(req, res) {
  return handleMusic(req, res)
}
