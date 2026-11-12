import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from './AuthContext.jsx'
import { useToast } from './ToastContext.jsx'
import { fetchFavoriteIds, insertFavorite, deleteFavorite } from '../lib/db.js'

/**
 * The signed-in user's favourites, shared by every heart button (cards, rows,
 * the player bar) so a toggle stays in sync everywhere, exactly like the old
 * document-wide syncFavorite() in player.js.
 */
const FavoritesContext = createContext(null)

export function FavoritesProvider({ children }) {
  const { session } = useAuth()
  const toast = useToast()
  const [ids, setIds] = useState(null) // null = not loaded yet
  const [loading, setLoading] = useState(true)
  const busy = useRef(new Set())

  const userId = session?.user?.id ?? null

  useEffect(() => {
    let alive = true
    if (!userId) {
      setIds(null)
      setLoading(false)
      return () => {}
    }
    setLoading(true)
    fetchFavoriteIds()
      .then((set) => {
        if (alive) {
          setIds(set)
          setLoading(false)
        }
      })
      .catch(() => {
        if (alive) {
          setIds(new Set())
          setLoading(false)
        }
      })
    return () => {
      alive = false
    }
  }, [userId])

  const isFav = useCallback((externalId) => Boolean(externalId && ids && ids.has(externalId)), [ids])

  /** Toggle one track. The UI updates immediately; a failed write rolls back. */
  const toggleFavorite = useCallback(
    async (track) => {
      if (!track || !track.external_id || !userId) return false
      const key = track.external_id
      if (busy.current.has(key)) return isFav(key)
      busy.current.add(key)

      const wasFav = Boolean(ids && ids.has(key))
      setIds((prev) => {
        const next = new Set(prev || [])
        if (wasFav) next.delete(key)
        else next.add(key)
        return next
      })

      try {
        if (wasFav) await deleteFavorite(key)
        else await insertFavorite(track)
        toast(wasFav ? 'Removed from your favorites.' : 'Added to your favorites.')
        return !wasFav
      } catch (err) {
        setIds((prev) => {
          const next = new Set(prev || [])
          if (wasFav) next.add(key)
          else next.delete(key)
          return next
        })
        toast(err?.message || 'Could not update favorites.', true)
        return wasFav
      } finally {
        busy.current.delete(key)
      }
    },
    [ids, isFav, toast, userId]
  )

  const value = useMemo(
    () => ({ ids, loading, isFav, toggleFavorite }),
    [ids, loading, isFav, toggleFavorite]
  )

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>
}

export function useFavorites() {
  const ctx = useContext(FavoritesContext)
  if (!ctx) throw new Error('useFavorites must be used inside <FavoritesProvider>')
  return ctx
}
