/**
 * Shared recommendation rules for the UI and the playback queue.
 *
 * YouTube video resources do not carry a reliable genre field, so the primary
 * query uses the current artist (same artist = same style). A track's own
 * `genre` metadata wins when a saved/library row happens to have one.
 */

const NOISE =
  /\b(official|music|video|hd|hq|4k|visualizer|visualiser|teaser|mv|full|explicit)\b/gi

export function normalizeSongTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(NOISE, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeArtist(artist) {
  return String(artist || '')
    .toLowerCase()
    .replace(/\s*(vevo|topic|official)\s*$/i, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Same video id, or the same recording under a different upload. */
export function isSameSong(a, b) {
  if (!a || !b) return false
  if (a.external_id && a.external_id === b.external_id) return true
  const at = normalizeSongTitle(a.title)
  const bt = normalizeSongTitle(b.title)
  if (!at || at !== bt) return false
  const aa = normalizeArtist(a.artist)
  const ba = normalizeArtist(b.artist)
  return !aa || !ba || aa === ba || aa.includes(ba) || ba.includes(aa)
}

/** User-facing wording that distinguishes a real "no match" from a failure. */
export function recommendationErrorMessage(err) {
  const code = String((err && err.code) || '')
  if (code === 'quota') return 'YouTube’s daily limit is reached. Recommendations will return when it resets.'
  if (code === 'rate_limited') {
    const seconds = Number(err && err.retryAfter)
    return Number.isFinite(seconds) && seconds > 0
      ? `The music service is busy. Try again in about ${Math.ceil(seconds)} seconds.`
      : 'The music service is busy. Please try again shortly.'
  }
  if (code === 'not_configured') return 'Recommendations are not configured on the server yet.'
  if (code === 'timeout') return 'Finding similar music took too long. Please try again.'
  return (err && err.message) || 'Could not load recommendations right now.'
}

/** One search phrase per track - kept for callers that still use plain search. */
export function recommendationQuery(track) {
  const genre = String(track?.genre || '').toLowerCase().trim()
  if (genre) return `${genre} music`
  const artist = normalizeArtist(track?.artist)
  if (artist) return `${artist} music`
  return 'popular music'
}

/**
 * De-duplicate search results, remove the current song (including re-uploads)
 * and anything already suggested/played recently, then prefer the same artist
 * before keeping the API's relevance order.
 */
export function pickRecommendations(tracks, current, excludeIds = [], limit = 6) {
  const excluded = new Set(excludeIds.filter(Boolean))
  if (current?.external_id) excluded.add(current.external_id)
  const currentTitle = normalizeSongTitle(current?.title)
  const currentArtist = normalizeArtist(current?.artist)
  const seenTitles = new Set(currentTitle ? [currentTitle] : [])
  const seenIds = new Set(excluded)
  const picked = []

  for (const t of Array.isArray(tracks) ? tracks : []) {
    if (!t || !t.external_id || seenIds.has(t.external_id)) continue
    if (isSameSong(t, current)) continue
    const title = normalizeSongTitle(t.title)
    if (title && seenTitles.has(title)) continue
    seenIds.add(t.external_id)
    if (title) seenTitles.add(title)
    picked.push({ ...t, similar: Boolean(currentArtist && normalizeArtist(t.artist) === currentArtist) })
  }

  picked.sort((a, b) => Number(b.similar) - Number(a.similar))
  return picked.slice(0, limit)
}
