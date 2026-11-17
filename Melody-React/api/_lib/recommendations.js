/**
 * Genre/style-aware recommendation strategies.
 *
 * YouTube videos rarely carry a usable genre field, so a single "artist music"
 * query is fragile: it finds the same artist (or nothing) and makes failures
 * look like "no related songs". These helpers build a small, bounded set of
 * different queries and rank the combined results by musical similarity.
 */
import { createHash } from 'node:crypto'

const STYLE_GROUPS = [
  {
    name: 'Progressive House',
    terms: [
      'progressive house', 'progressive', 'ncs', 'no copyright sounds', 'electro house',
      'elektronomia', 'jim yosef', 'alex skrindo', 'electro-light', 'different heaven',
    ],
    related: ['electro house', 'future house', 'edm'],
  },
  {
    name: 'Future House',
    terms: ['future house', 'future bass', 'future'],
    related: ['progressive house', 'electro house', 'edm'],
  },
  {
    name: 'Dubstep',
    terms: ['dubstep', 'melodic dubstep', 'drumstep', 'bass music', 'brostep'],
    related: ['drumstep', 'future bass', 'edm'],
  },
  {
    name: 'Trap',
    terms: ['trap', 'hard trap', 'trap music'],
    related: ['hip hop', 'edm', 'bass music'],
  },
  {
    name: 'EDM',
    terms: ['edm', 'electronic dance', 'dance music', 'house music', 'electro'],
    related: ['progressive house', 'future house', 'electro house'],
  },
  {
    name: 'Hip Hop',
    terms: ['hip hop', 'rap', 'r&b'],
    related: ['trap', 'soul'],
  },
  {
    name: 'Rock',
    terms: ['rock', 'alternative', 'indie', 'metal'],
    related: ['indie', 'alternative'],
  },
  {
    name: 'Jazz',
    terms: ['jazz', 'swing', 'bebop'],
    related: ['soul', 'blues'],
  },
  {
    name: 'Classical',
    terms: ['classical', 'orchestral', 'symphony', 'piano'],
    related: ['orchestral', 'soundtrack'],
  },
]

const clean = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}&\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const unique = (list) => [...new Set(list.filter(Boolean))]

/** Search metadata stores the UPLOADER as the artist; the real performer is
    usually the part before " - " in the title (e.g. "Elektronomia - Energy"). */
function performer(seed) {
  const title = clean(seed && seed.title).replace(/\s+\[[^\]]*\]\s*$/, '')
  const parts = title.split(/\s+[-–—]\s+/)
  return parts.length > 1 ? parts[0].trim() : ''
}

/** Best-effort style detection from metadata, title and channel. */
export function inferStyle(track) {
  const seed = track || {}
  const explicit = clean(seed.genre)
  const hay = clean(`${seed.title || ''} ${seed.artist || ''} ${performer(seed)}`)
  const ncs = /\bncs\b|no copyright sounds/.test(hay)

  const matches = (terms) => terms.some((t) => explicit === t || explicit.includes(t) || hay.includes(t))
  const group = STYLE_GROUPS.find((g) => matches(g.terms))
  if (!group) {
    return { name: explicit || '', related: [], ncs, generic: !explicit }
  }
  return {
    name: group.name,
    terms: group.terms,
    related: group.related.filter((r) => !matches([r])),
    ncs,
    generic: false,
  }
}

/**
 * Ordered, de-duplicated search phrases for one seed song. The first query is
 * genre-driven (not just the artist); later ones broaden the style or artist.
 */
export function recommendationQueries(track, max = 3) {
  const seed = track || {}
  const style = inferStyle(seed)
  const names = unique([
    performer(seed),
    clean(seed.artist).replace(/\s+(vevo|topic|official)$/, ''),
  ])
  const title = clean(seed.title).replace(/\s+(official\s*video|music\s*video|audio|lyrics?)$/, '')
  const queries = []

  if (style.name) {
    queries.push(`${style.name} music`)
    for (const name of names) {
      if (queries.length >= max) break
      queries.push(`${name} ${style.name}`)
    }
    if (style.ncs && queries.length < max) queries.push('NCS electronic dance music')
    for (const related of style.related) {
      if (queries.length >= max) break
      queries.push(`${style.name} ${related} music`)
    }
  }
  for (const name of names) {
    if (queries.length >= max) break
    queries.push(`${name} music`)
  }
  if (names[0] && title && queries.length < max) queries.push(`${names[0]} ${title} similar music`)

  return unique(queries.map((q) => q.replace(/\s+/g, ' ').trim())).slice(0, Math.max(1, max))
}

/** Same-recording detection for the seed, including re-uploads. */
function isSeedSong(track, seed, style) {
  if (!track) return true
  if (seed.external_id && track.external_id === seed.external_id) return true
  const t = clean(track.title).replace(/\b(official|music|video|hd|hq|4k|visualizer|mv|full|explicit)\b/g, ' ')
  const s = clean(seed.title).replace(/\b(official|music|video|hd|hq|4k|visualizer|mv|full|explicit)\b/g, ' ')
  if (!t || !s || t !== s) return false
  const ta = clean(track.artist).replace(/\s+(vevo|topic|official)$/, '')
  const sa = clean(seed.artist).replace(/\s+(vevo|topic|official)$/, '')
  return !ta || !sa || ta === sa || ta.includes(sa) || sa.includes(ta)
}

/**
 * Combine results from all strategies: drop the seed/duplicates, cap how many
 * songs one artist can contribute, then rank by style/artist relevance while
 * keeping the API's relevance order as the tiebreaker.
 */
export function rankRecommendations(tracks, seed, style = inferStyle(seed)) {
  const seen = new Set()
  const perArtist = new Map()
  const artist = clean(seed && seed.artist).replace(/\s+(vevo|topic|official)$/, '')
  const terms = unique([...(style.terms || []), ...(style.related || []), style.name])

  const scored = []
  for (const [index, track] of (Array.isArray(tracks) ? tracks : []).entries()) {
    if (!track || !track.external_id || seen.has(track.external_id)) continue
    if (isSeedSong(track, seed, style)) continue
    seen.add(track.external_id)
    const trackArtist = clean(track.artist).replace(/\s+(vevo|topic|official)$/, '')
    const count = perArtist.get(trackArtist) || 0
    if (count >= 3) continue
    const hay = clean(`${track.title || ''} ${track.artist || ''} ${track.category_id || ''}`)
    let score = 0
    if (artist && trackArtist === artist) score += 3
    if (terms.some((term) => term && hay.includes(term))) score += 4
    if (style.ncs && /\bncs\b|no copyright sounds/.test(hay)) score += 3
    if (track.duration > 0) score += 1
    perArtist.set(trackArtist, count + 1)
    scored.push({ track, score, index })
  }
  scored.sort((a, b) => b.score - a.score || a.index - b.index)
  return scored.map((entry) => entry.track)
}

/** Stable cache key for one seed song. */
export function seedCacheKey(seed) {
  const normalized = [
    clean(seed && seed.external_id),
    clean(seed && seed.title),
    clean(seed && seed.artist),
    clean(seed && seed.genre),
  ].join('|')
  return `rec:${createHash('sha256').update(normalized).digest('hex').slice(0, 32)}`
}
