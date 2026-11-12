import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase, requireSupabase } from '../lib/supabase.js'
import { fetchProfile } from '../lib/db.js'

/**
 * Supabase Auth session state.
 *
 * Registration NEVER leaves a session behind: signUp() is followed by
 * signOut() so the visitor is always sent to the login page afterwards,
 * exactly like the original PHP flow (register.php -> login.php?registered=1).
 */
const AuthContext = createContext(null)

const USERNAME_RE = /^[A-Za-z0-9._]{3,50}$/

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return undefined
    }
    let alive = true

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (alive) {
          setSession(data.session ?? null)
          setLoading(false)
        }
      })
      .catch(() => {
        if (alive) setLoading(false)
      })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next ?? null)
    })

    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const userId = session?.user?.id ?? null

  useEffect(() => {
    let alive = true
    if (!userId || !supabase) {
      setProfile(null)
      return () => {}
    }
    fetchProfile(userId)
      .then((row) => {
        if (alive) setProfile(row)
      })
      .catch(() => {
        if (alive) setProfile(null)
      })
    return () => {
      alive = false
    }
  }, [userId])

  /** Validate + create the account, then sign out. Returns { error }. */
  const signUp = useCallback(async ({ username, email, password, confirm }) => {
    const db = requireSupabase()
    const u = (username || '').trim()
    const e = (email || '').trim()

    if (!u) return { error: 'Please choose a username.' }
    if (!USERNAME_RE.test(u)) {
      return {
        error:
          'Username must be 3-50 characters: letters, numbers, dots or underscores only.',
      }
    }
    if (!e) return { error: 'Please enter your email address.' }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { error: 'Please enter a valid email address.' }
    if (!password) return { error: 'Please enter a password.' }
    if (password.length < 8) return { error: 'Your password must contain at least 8 characters.' }
    if (password !== confirm) return { error: 'Your passwords do not match.' }

    const { data, error } = await db.auth.signUp({
      email: e,
      password,
      options: { data: { username: u } },
    })

    // Always drop any session Supabase may have opened: registering must not
    // sign anyone in - the user logs in on the login page like everyone else.
    try {
      await db.auth.signOut()
    } catch {
      /* nothing to clean up */
    }

    if (error) {
      const msg = error.message || ''
      if (/already registered/i.test(msg)) return { error: 'This email address is already registered.' }
      if (/rate limit/i.test(msg)) return { error: 'Too many attempts. Please try again in a moment.' }
      return { error: msg || "We couldn't create your account. Please try again." }
    }

    // Email confirmation ON -> Supabase returns no session; OFF -> it returns
    // one, which we just cleared. Either way the next screen is the login page.
    void data
    return { error: null }
  }, [])

  const signIn = useCallback(async ({ email, password }) => {
    const db = requireSupabase()
    const e = (email || '').trim()
    if (!e || !password) {
      return { error: 'Please enter your email and password.' }
    }
    const { error } = await db.auth.signInWithPassword({ email: e, password })
    if (error) {
      const msg = error.message || ''
      if (/invalid login credentials/i.test(msg)) {
        return { error: 'Invalid email or password.' }
      }
      if (/rate limit/i.test(msg)) {
        return { error: 'Too many attempts. Please try again in a moment.' }
      }
      return { error: msg || 'We could not sign you in right now. Please try again later.' }
    }
    return { error: null }
  }, [])

  const signOut = useCallback(async () => {
    if (!supabase) return
    try {
      await supabase.auth.signOut()
    } catch {
      /* the local session is cleared by the state change either way */
    }
    setProfile(null)
  }, [])

  const value = useMemo(
    () => ({ session, profile, loading, isAuthenticated: Boolean(session), signUp, signIn, signOut }),
    [session, profile, loading, signUp, signIn, signOut]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
