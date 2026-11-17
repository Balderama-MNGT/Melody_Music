/** Vercel entry point for idempotent play recording. */
import { handlePlays } from './_lib/plays.js'

export default async function handler(req, res) {
  return handlePlays(req, res)
}
