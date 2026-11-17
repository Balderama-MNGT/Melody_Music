/**
 * Supabase queries for Melody's user-owned data.
 *
 * Every table is protected by Row Level Security (supabase_schema.sql), so a
 * user can only ever read or write their own playlists, playlist tracks,
 * favourites and listening history - even if a query forgot its own filter.
 */
import { requireSupabase } from './supabase.js'
import { getAuthHeaders } from './api.js'

const HISTORY_SCAN_LIMIT = 500

/** A saved track row -> the track shape the UI and player use. */
export function rowToTrack(row) {
  return {
    external_id: row.external_id,
    title: row.title,
    artist: row.artist || 'Unknown artist',
    cover: row.cover || '',
    duration: Number(row.duration) || 0,
  }
}

function fail(message) {
  const err = new Error(message)
  err.db = true
  return err
}

function errorMessage(res) {
  return res?.error?.message || 'The database request failed.'
}

/* ----------------------------- favourites ----------------------------- */

export async function fetchFavoriteTracks() {
  const db = requireSupabase()
  const { data, error } = await db
    .from('favorites')
    .select('external_id, title, artist, cover, duration, created_at')
    .order('created_at', { ascending: false })
  if (error) throw fail(errorMessage({ error }))
  return (data || []).map((r) => ({ ...rowToTrack(r), created_at: r.created_at }))
}

export async function fetchFavoriteIds() {
  const db = requireSupabase()
  const { data, error } = await db.from('favorites').select('external_id')
  if (error) throw fail(errorMessage({ error }))
  return new Set((data || []).map((r) => r.external_id))
}

export async function insertFavorite(track) {
  const db = requireSupabase()
  const { error } = await db.from('favorites').insert({
    external_id: track.external_id,
    title: track.title,
    artist: track.artist,
    cover: track.cover || null,
    duration: Number(track.duration) || 0,
  })
  if (error) throw fail(errorMessage({ error }))
}

export async function deleteFavorite(externalId) {
  const db = requireSupabase()
  const { error } = await db.from('favorites').delete().eq('external_id', externalId)
  if (error) throw fail(errorMessage({ error }))
}

/* ------------------------------ playlists ----------------------------- */

export async function fetchPlaylists() {
  const db = requireSupabase()
  const { data, error } = await db
    .from('playlists')
    .select('id, name, created_at, playlist_tracks(external_id, cover, added_at)')
    .order('created_at', { ascending: false })
  if (error) throw fail(errorMessage({ error }))

  return (data || []).map((p) => {
    const tracks = p.playlist_tracks || []
    const newest = [...tracks].sort(
      (a, b) => new Date(b.added_at) - new Date(a.added_at)
    )[0]
    return {
      id: p.id,
      name: p.name,
      created_at: p.created_at,
      track_count: tracks.length,
      cover: newest?.cover || '',
    }
  })
}

/** Lightweight list for the "add to playlist" picker (id + name only). */
export async function fetchPlaylistOptions() {
  const db = requireSupabase()
  const { data, error } = await db
    .from('playlists')
    .select('id, name')
    .order('name', { ascending: true })
  if (error) throw fail(errorMessage({ error }))
  return data || []
}

/** One playlist, but only when it belongs to the signed-in user (RLS). */
export async function fetchPlaylist(id) {
  const db = requireSupabase()
  const { data, error } = await db
    .from('playlists')
    .select('id, name, created_at')
    .eq('id', id)
    .maybeSingle()
  if (error) throw fail(errorMessage({ error }))
  return data || null
}

export async function fetchPlaylistTracks(playlistId) {
  const db = requireSupabase()
  const { data, error } = await db
    .from('playlist_tracks')
    .select('external_id, title, artist, cover, duration, added_at')
    .eq('playlist_id', playlistId)
    .order('added_at', { ascending: true })
  if (error) throw fail(errorMessage({ error }))
  return (data || []).map((r) => ({ ...rowToTrack(r), added_at: r.added_at }))
}

export async function createPlaylist(name) {
  const db = requireSupabase()
  const { data, error } = await db
    .from('playlists')
    .insert({ name })
    .select('id, name')
    .single()
  if (error) throw fail(errorMessage({ error }))
  return data
}

export async function renamePlaylist(id, name) {
  const db = requireSupabase()
  const { data, error } = await db
    .from('playlists')
    .update({ name })
    .eq('id', id)
    .select('id')
  if (error) throw fail(errorMessage({ error }))
  if (!data || data.length === 0) throw fail('Playlist not found.')
}

export async function deletePlaylist(id) {
  const db = requireSupabase()
  const { data, error } = await db
    .from('playlists')
    .delete()
    .eq('id', id)
    .select('id')
  if (error) throw fail(errorMessage({ error }))
  if (!data || data.length === 0) throw fail('Playlist not found.')
}

export async function addTrackToPlaylist(playlistId, track) {
  const db = requireSupabase()
  const { error } = await db.from('playlist_tracks').insert({
    playlist_id: playlistId,
    external_id: track.external_id,
    title: track.title,
    artist: track.artist,
    cover: track.cover || null,
    duration: Number(track.duration) || 0,
  })
  if (error) {
    if (error.code === '23505') return { added: false } // primary key: already there
    throw fail(errorMessage({ error }))
  }
  return { added: true }
}

export async function removeTrackFromPlaylist(playlistId, externalId) {
  const db = requireSupabase()
  const { error } = await db
    .from('playlist_tracks')
    .delete()
    .eq('playlist_id', playlistId)
    .eq('external_id', externalId)
  if (error) throw fail(errorMessage({ error }))
}

/* --------------------------- listening history ------------------------ */

/** Newest first, capped so very large histories stay cheap to aggregate. */
export async function fetchHistory(limit = HISTORY_SCAN_LIMIT) {
  const db = requireSupabase()
  const { data, error } = await db
    .from('listening_history')
    .select('external_id, title, artist, cover, duration, played_at')
    .order('played_at', { ascending: false })
    .limit(limit)
  if (error) throw fail(errorMessage({ error }))
  return (data || []).map((r) => ({ ...rowToTrack(r), played_at: r.played_at }))
}

/**
 * One entry per track: total plays + when it was played last.
 * (The MySQL version did this with GROUP BY song_id - here we aggregate the
 * newest-first list in one pass, which matches "MAX(played_at) ... COUNT(*)".)
 */
export function distinctByTrack(rows) {
  const map = new Map()
  for (const row of rows) {
    const found = map.get(row.external_id)
    if (found) {
      found.plays += 1
    } else {
      map.set(row.external_id, { ...row, plays: 1 })
    }
  }
  return [...map.values()]
}

/** Record one play. Metadata is snapshotted so the row stands alone. */
export async function recordPlay(track) {
  const db = requireSupabase()
  const { error } = await db.from('listening_history').insert({
    external_id: track.external_id,
    title: track.title,
    artist: track.artist,
    cover: track.cover || null,
    duration: Number(track.duration) || 0,
  })
  if (error) throw fail(errorMessage({ error }))
}

/**
 * Record one play through the protected backend. The session id is generated
 * per track selection; the backend + a UNIQUE database constraint make repeated
 * calls (repeat-one, double PLAYING events, retries) harmless.
 */
export async function recordPlaySession(track, sessionId, listenedMs = 0) {
  const headers = await getAuthHeaders()
  const res = await fetch('/api/plays', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({
      sessionId,
      listenedMs,
      track: {
        external_id: track.external_id,
        title: track.title,
        artist: track.artist,
        cover: track.cover || null,
        duration: Number(track.duration) || 0,
      },
    }),
  })
  let json = null
  try {
    json = await res.json()
  } catch {
    /* handled below */
  }
  if (!res.ok) throw fail((json && json.error) || 'Could not record this play.')
  return json || { ok: true }
}

/* -------------------------------- library ------------------------------ */

/**
 * Library data in one pass: favorites + listening history merged into one
 * de-duplicated list (favourites win when a track is in both), the ten most
 * recently played tracks and a play count per track.
 * The PHP app read this from the shared `songs` table; here every row carries
 * its own snapshot of the metadata, so nothing has to exist anywhere else.
 */
export async function fetchLibraryBundle() {
  const [favs, history] = await Promise.all([fetchFavoriteTracks(), fetchHistory()])
  const distinct = distinctByTrack(history)
  const plays = new Map(distinct.map((t) => [t.external_id, t.plays]))

  const map = new Map()
  for (const row of favs) map.set(row.external_id, { ...row, is_fav: true })
  for (const row of history) {
    if (!map.has(row.external_id)) map.set(row.external_id, { ...row, is_fav: false })
  }
  const tracks = [...map.values()].sort((a, b) => a.title.localeCompare(b.title))
  return { tracks, recent: distinct.slice(0, 10), plays }
}

/** Just the merged, de-duplicated track list. */
export async function fetchLibraryTracks() {
  const { tracks } = await fetchLibraryBundle()
  return tracks
}

/* -------------------------------- counts ------------------------------ */

/** Exact counts for the home hero (head:true: no rows are transferred). */
export async function fetchStats() {
  const db = requireSupabase()
  const [favs, lists, plays] = await Promise.all([
    db.from('favorites').select('external_id', { count: 'exact', head: true }),
    db.from('playlists').select('id', { count: 'exact', head: true }),
    db.from('listening_history').select('id', { count: 'exact', head: true }),
  ])
  if (favs.error) throw fail(errorMessage({ error: favs.error }))
  if (lists.error) throw fail(errorMessage({ error: lists.error }))
  if (plays.error) throw fail(errorMessage({ error: plays.error }))
  return {
    favs: favs.count || 0,
    lists: lists.count || 0,
    plays: plays.count || 0,
  }
}

/* ------------------------- signed-in user's profile -------------------- */

export async function fetchProfile(userId) {
  const db = requireSupabase()
  const { data, error } = await db
    .from('profiles')
    .select('id, username, role, created_at')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw fail(errorMessage({ error }))
  return data || null
}
