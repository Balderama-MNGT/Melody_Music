/**
 * Unit checks for music-content classification and version preservation.
 * Run: node scripts/test-search.mjs   (no network, no credentials)
 */
import { isMusicRelated } from '../api/_lib/youtube.js'
import {
  inferStyle,
  recommendationQueries,
  rankRecommendations,
  seedCacheKey,
} from '../api/_lib/recommendations.js'
import { isSameSong, normalizeSongTitle } from '../src/lib/recommendations.js'

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -> ${detail}` : ''}`)
}

const video = (title, description = '', channel = 'Some Channel', tags = [], extra = {}) => ({
  snippet: { title, description, channelTitle: channel, tags, categoryId: '' },
  ...extra,
})

const musicCases = [
  ['official music video', video('Artist - Song (Official Video)', 'Official music video', 'ArtistVEVO')],
  ['lyric video', video('Artist - Song (Lyrics)', 'Lyric video', 'Lyrics Channel')],
  ['audio upload', video('Artist - Song [Audio]', 'Audio only', 'Records')],
  ['live performance', video('Artist - Song (Live at Wembley)', 'Live performance', 'Artist')],
  ['concert recording', video('Artist Concert 2024 Full', 'Concert recording', 'Concerts')],
  ['acoustic', video('Artist - Song (Acoustic)', 'Acoustic session', 'Artist')],
  ['cover', video('Song Cover by Artist', 'Cover rendition', 'Artist')],
  ['remix / extended', video('Artist - Song (Extended Remix)', 'Remix', 'DJ Channel')],
  ['instrumental', video('Artist - Song (Instrumental)', 'Instrumental version', 'Artist')],
  ['DJ set / mix', video('Summer Hits Mix 2024', 'DJ mix compilation', 'Mixes')],
  ['karaoke', video('Song Karaoke Version', 'Karaoke', 'Karaoke Channel')],
  ['compilation', video('Best Indie Songs Compilation', 'Music compilation', 'Indie Music')],
  ['miscategorised but musical', video('A quiet piano piece', 'Original composition', 'Composer')],
  ['category 10 with odd title', video('Untitled', '', 'Uploads', [], { categoryId: '10' })],
]
for (const [name, v] of musicCases) check(`allowed: ${name}`, isMusicRelated(v) === true)

const unrelated = [
  ['gameplay', video('Gameplay Walkthrough Level 5', 'Playthrough of the game', 'Gamer')],
  ['tutorial', video('How to fix a sink', 'Step by step tutorial', 'DIY')],
  ['podcast', video('Episode 42 - News', 'Podcast interview', 'News')],
]
for (const [name, v] of unrelated) check(`rejected: ${name}`, isMusicRelated(v) === false)

/* Different performances of the same song must stay distinct, while an exact
   re-upload (differing only by "Official Video") is still one recording. */
check('live and studio versions stay distinct',
  isSameSong({ title: 'Song (Live)', artist: 'Artist' }, { title: 'Song (Studio Version)', artist: 'Artist' }) === false,
  normalizeSongTitle('Song (Live)'))
check('remix stays distinct from original',
  isSameSong({ title: 'Song (Remix)', artist: 'Artist' }, { title: 'Song', artist: 'Artist' }) === false)
check('official-video re-upload is the same song',
  isSameSong({ title: 'Song (Official Video)', artist: 'Artist' }, { title: 'Song', artist: 'Artist' }) === true)

/* ---------------------- genre-aware recommendation rules ----------------- */
const seed = {
  external_id: 'energyvid0001',
  title: 'Elektronomia - Energy [NCS Release]',
  artist: 'NoCopyrightSounds',
  genre: 'Progressive House',
}
const style = inferStyle(seed)
check('style inferred from genre metadata', style.name === 'Progressive House', style.name)
const queries = recommendationQueries(seed, 3)
check('first strategy is genre-driven, not artist-only', /^progressive house music$/i.test(queries[0]), queries.join(' | '))
const allQueries = recommendationQueries(seed, 6)
check('strategies include artist and related styles',
  queries.length === 3 && queries.some((q) => /elektronomia/i.test(q)) &&
  allQueries.some((q) => /electro house|future house|edm/i.test(q)), allQueries.join(' | '))
check('queries are unique', new Set(queries).size === queries.length)
check('NCS seed adds an electronic-music strategy',
  recommendationQueries(seed, 6).some((q) => /NCS electronic dance music/i.test(q)))

const noGenre = inferStyle({ title: 'Song', artist: 'Elektronomia', genre: '' })
check('style inferred from artist when metadata is missing', noGenre.name === 'Progressive House', noGenre.name)

const recTracks = [
  { external_id: 'a1', title: 'Elektronomia - Sky High', artist: 'Elektronomia', category_id: '10' },
  { external_id: 'a2', title: 'Elektronomia - Another Mix', artist: 'Elektronomia' },
  { external_id: 'a3', title: 'Elektronomia - Third Mix', artist: 'Elektronomia' },
  { external_id: 'a4', title: 'Elektronomia - Fourth Mix', artist: 'Elektronomia' },
  { external_id: 'b1', title: 'Jim Yosef - Link', artist: 'Jim Yosef' },
  { external_id: 'b2', title: 'Alex Skrindo - Latency', artist: 'Alex Skrindo' },
  { external_id: 'seed1', title: 'Elektronomia - Energy [NCS Release]', artist: 'NoCopyrightSounds' },
  { external_id: 'seed2', title: 'Elektronomia - Energy (Official Video)', artist: 'Elektronomia' },
]
const ranked = rankRecommendations(recTracks, seed, style)
check('seed and re-upload are excluded', !ranked.some((t) => /^seed/.test(t.external_id)), ranked.map((t) => t.external_id).join(','))
check('duplicate video ids removed', new Set(ranked.map((t) => t.external_id)).size === ranked.length)
check('one artist cannot flood the list', ranked.filter((t) => t.artist === 'Elektronomia').length <= 3)
check('different artists are recommended', new Set(ranked.map((t) => t.artist)).size >= 2, ranked.map((t) => t.artist).join(','))
const keyA = seedCacheKey(seed)
check('seed cache key is stable and seed-specific',
  keyA === seedCacheKey({ ...seed }) && keyA !== seedCacheKey({ ...seed, title: 'Other' }))

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} search checks passed`)
if (failed.length) process.exitCode = 1
