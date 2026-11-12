import { createClient } from '@supabase/supabase-js'

/**
 * Supabase browser client.
 *
 * VITE_* variables are the only ones the bundle can see, and the anon key is
 * safe there because every user-owned table is protected by Row Level Security
 * (see supabase_schema.sql). No private credential ever reaches this file.
 */
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(url && anonKey)

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null

/**
 * Returns the client or throws a clear message when configuration is missing,
 * so the UI can say exactly what is wrong instead of failing with a TypeError.
 */
export function requireSupabase() {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured yet. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment.'
    )
  }
  return supabase
}
