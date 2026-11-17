import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useAuth } from './AuthContext.jsx'
import { useToast } from './ToastContext.jsx'
import {
  addTrackToPlaylist,
  createPlaylist,
  deletePlaylist,
  fetchPlaylists,
  removeTrackFromPlaylist,
  renamePlaylist,
} from '../lib/db.js'

/**
 * One shared view of the signed-in user's playlists. Every Add-to-playlist
 * button, the picker, the playlist list and the quick tiles read and update
 * this state, so an insert is reflected immediately without a page refresh.
 * No Supabase Realtime subscription is needed for a single-user session.
 */
const PlaylistsContext = createContext(null)

export function PlaylistsProvider({ children }) {
  const { session } = useAuth()
  const toast = useToast()
  const [playlists, setPlaylists] = useState([])
  const [loading, setLoading] = useState(true)
  const playlistsRef = useRef(playlists)
  playlistsRef.current = playlists
  const userId = session?.user?.id ?? null

  const refresh = useCallback(async () => {
    if (!userId) {
      setPlaylists([])
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      setPlaylists(await fetchPlaylists())
    } catch {
      setPlaylists([])
    } finally {
      setLoading(false)
    }
  }, [userId])

  useEffect(() => {
    let alive = true
    if (!userId) {
      setPlaylists([])
      setLoading(false)
      return () => {}
    }
    setLoading(true)
    fetchPlaylists()
      .then((rows) => alive && setPlaylists(rows))
      .catch(() => alive && setPlaylists([]))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [userId])

  const isInPlaylist = useCallback(
    (playlistId, externalId) =>
      Boolean(
        externalId &&
          (playlists.find((p) => p.id === playlistId)?.trackIds || []).includes(externalId)
      ),
    [playlists]
  )
  const isInAnyPlaylist = useCallback(
    (externalId) =>
      Boolean(externalId && playlists.some((p) => (p.trackIds || []).includes(externalId))),
    [playlists]
  )

  /** Insert one video ID; a duplicate is a successful no-op. */
  const addTrack = useCallback(
    async (playlistId, track) => {
      if (!playlistId || !track?.external_id || !userId) {
        throw new Error('Sign in to add songs to playlists.')
      }
      const existing = playlistsRef.current.find((p) => p.id === playlistId)
      if (existing && (existing.trackIds || []).includes(track.external_id)) {
        toast('Already Added to this playlist.', true)
        return { added: false, duplicate: true }
      }
      const res = await addTrackToPlaylist(playlistId, track)
      if (!res.added) {
        toast('Already Added to this playlist.', true)
        return { added: false, duplicate: true }
      }
      setPlaylists((prev) =>
        prev.map((p) => {
          if (p.id !== playlistId) return p
          const trackIds = [...new Set([...(p.trackIds || []), track.external_id])]
          return {
            ...p,
            trackIds,
            track_count: trackIds.length,
            cover: p.cover || track.cover || '',
          }
        })
      )
      toast(`Added to “${existing?.name || 'playlist'}”.`)
      return { added: true }
    },
    [toast, userId]
  )

  const createAndAdd = useCallback(
    async (name, track) => {
      if (!track?.external_id || !userId) throw new Error('Sign in to add songs to playlists.')
      const created = await createPlaylist(name)
      await addTrackToPlaylist(created.id, track)
      setPlaylists((prev) => [
        {
          id: created.id,
          name: created.name,
          created_at: new Date().toISOString(),
          trackIds: [track.external_id],
          track_count: 1,
          cover: track.cover || '',
        },
        ...prev,
      ])
      toast(`Added to “${created.name}”.`)
      return { added: true }
    },
    [toast, userId]
  )

  const create = useCallback(
    async (name) => {
      const created = await createPlaylist(name)
      setPlaylists((prev) => [
        {
          id: created.id,
          name: created.name,
          created_at: new Date().toISOString(),
          trackIds: [],
          track_count: 0,
          cover: '',
        },
        ...prev,
      ])
      return created
    },
    []
  )

  const rename = useCallback(async (id, name) => {
    await renamePlaylist(id, name)
    setPlaylists((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)))
  }, [])

  const remove = useCallback(async (id) => {
    await deletePlaylist(id)
    setPlaylists((prev) => prev.filter((p) => p.id !== id))
  }, [])

  const removeTrack = useCallback(async (playlistId, externalId) => {
    await removeTrackFromPlaylist(playlistId, externalId)
    setPlaylists((prev) =>
      prev.map((p) => {
        if (p.id !== playlistId) return p
        const trackIds = (p.trackIds || []).filter((id) => id !== externalId)
        return { ...p, trackIds, track_count: trackIds.length }
      })
    )
  }, [])

  const value = useMemo(
    () => ({
      playlists,
      loading,
      refresh,
      isInPlaylist,
      isInAnyPlaylist,
      addTrack,
      createAndAdd,
      create,
      rename,
      remove,
      removeTrack,
    }),
    [
      playlists,
      loading,
      refresh,
      isInPlaylist,
      isInAnyPlaylist,
      addTrack,
      createAndAdd,
      create,
      rename,
      remove,
      removeTrack,
    ]
  )

  return <PlaylistsContext.Provider value={value}>{children}</PlaylistsContext.Provider>
}

export function usePlaylists() {
  const ctx = useContext(PlaylistsContext)
  if (!ctx) throw new Error('usePlaylists must be used inside <PlaylistsProvider>')
  return ctx
}
