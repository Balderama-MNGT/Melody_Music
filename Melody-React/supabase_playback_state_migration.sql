-- ============================================================================
-- Melody - per-user playback state (safe to re-run).
-- Stores only the listener's last player snapshot, never credentials/API keys.
-- Existing tables and rows are untouched.
-- ============================================================================

create table if not exists public.playback_state (
    user_id          uuid primary key references auth.users (id) on delete cascade,
    current_track    jsonb,
    queue            jsonb not null default '[]'::jsonb,
    track_index      integer not null default -1,
    playback_mode    text not null default 'recommendations'
        check (playback_mode in ('recommendations', 'playlist')),
    active_playlist  jsonb,
    position_seconds real not null default 0 check (position_seconds >= 0),
    shuffle          boolean not null default false,
    repeat_mode      text not null default 'off'
        check (repeat_mode in ('off', 'all', 'one')),
    updated_at       timestamptz not null default now()
);

alter table public.playback_state enable row level security;

drop policy if exists "own playback state" on public.playback_state;
create policy "own playback state" on public.playback_state
    for all to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

grant select, insert, update, delete on public.playback_state to authenticated;
