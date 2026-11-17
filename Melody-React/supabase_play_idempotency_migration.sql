-- ============================================================================
-- Melody - idempotent play records  (SAFE, ADDITIVE MIGRATION)
-- ============================================================================
-- Purpose: stop automatic song repetition / repeated player events from
-- creating duplicate listening_history rows, without touching existing rows.
--
-- What it changes:
--   1. Adds play_session_id (nullable UUID). Old rows keep NULL and are left
--      exactly as they are - no deletes, no resets, no rewrites.
--   2. Adds a UNIQUE index on (user_id, play_session_id) for rows that have a
--      session id. The backend ignores duplicate inserts on this key.
--   3. Adds an index for the common "this user's plays of this track" query.
-- Row Level Security policies are NOT changed; the existing "own listening
-- history" policy still applies to every insert.
-- ============================================================================

alter table public.listening_history
  add column if not exists play_session_id uuid;

create unique index if not exists listening_history_user_session_uidx
  on public.listening_history (user_id, play_session_id)
  where play_session_id is not null;

create index if not exists listening_history_user_track_idx
  on public.listening_history (user_id, external_id, played_at desc);
