-- ============================================================================
--  Melody - Supabase schema (PostgreSQL)
-- ============================================================================
--  Run this once in the Supabase SQL Editor (Dashboard → SQL → New query).
--  It creates every table the React app uses plus the Row Level Security
--  policies that keep each user's data private.
--
--  Safe to re-run: nothing here deletes or overwrites existing rows - every
--  statement is "create ... if not exists" / "create or replace" /
--  "drop ... if exists". It never reads from MySQL either: Supabase starts
--  empty on purpose (see the migration notes at the bottom).
--
--  Tables created:
--    profiles           one row per account (username shown in the app)
--    playlists          a user's playlists
--    playlist_tracks    songs inside one playlist (metadata snapshotted)
--    favorites          songs the user tapped the heart on
--    listening_history  one row per play
-- ============================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()

-- ----------------------------------------------------------------------------
-- profiles: created automatically for every new account (see trigger below)
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
    id         uuid primary key references auth.users (id) on delete cascade,
    email      text,
    username   text not null unique,
    role       text not null default 'user' check (role in ('user', 'admin')),
    created_at timestamptz not null default now(),
    constraint profiles_username_check check (username ~ '^[A-Za-z0-9._]{3,50}$')
);

-- Projects created before this column existed gain it here (idempotent).
alter table public.profiles add column if not exists email text;

comment on table public.profiles is
    'One row per Supabase auth user. Written by the handle_new_user trigger.';
comment on column public.profiles.email is
    'The account email, copied from auth.users. Not readable by other users
     (see the column grant below) - your own email comes from your session.';

-- ----------------------------------------------------------------------------
-- handle_new_user: builds the profile when auth.users gets a new row.
-- The username comes from the registration form (options.data.username);
-- if it is missing or already taken we derive a unique one - we never
-- overwrite or block an existing profile.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_base text;
    v_username text;
begin
    -- 1. what the user asked for, stripped to the allowed characters
    v_base := nullif(trim(coalesce(new.raw_user_meta_data ->> 'username', '')), '');
    if v_base is null then
        v_base := split_part(coalesce(new.email, 'user'), '@', 1);
    end if;
    v_base := regexp_replace(v_base, '[^A-Za-z0-9._]', '', 'g');
    if length(v_base) < 3 then
        v_base := 'user';
    end if;
    v_base := left(v_base, 40);

    -- 2. make it unique without touching anyone else's row
    v_username := v_base;
    if exists (select 1 from public.profiles p where p.username = v_username) then
        v_username := v_base || '_' || left(replace(new.id::text, '-', ''), 4);
    end if;
    if exists (select 1 from public.profiles p where p.username = v_username) then
        v_username := 'user_' || replace(new.id::text, '-', '');   -- unique by construction
    end if;

    begin
        insert into public.profiles (id, email, username)
        values (new.id, new.email, v_username)
        on conflict (id) do nothing;
    exception when unique_violation then
        insert into public.profiles (id, email, username)
        values (new.id, new.email, 'user_' || replace(new.id::text, '-', ''));
    end;

    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- sync_profile_email: keeps profiles.email in step when the account's email
-- is changed/confirmed later, so the copy on the profile row never goes stale.
-- ----------------------------------------------------------------------------
create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.profiles
       set email = new.email
     where id = new.id
       and email is distinct from new.email;
    return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
    after update of email on auth.users
    for each row
    when (old.email is distinct from new.email)
    execute function public.sync_profile_email();

-- Profiles created before the email column existed: fill the column once.
update public.profiles p
   set email = u.email
  from auth.users u
 where u.id = p.id
   and p.email is distinct from u.email;

-- ----------------------------------------------------------------------------
-- playlists: a user's own playlists (private to them)
-- ----------------------------------------------------------------------------
create table if not exists public.playlists (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
    name       text not null check (char_length(name) between 1 and 100),
    created_at timestamptz not null default now()
);

create index if not exists playlists_user_id_idx
    on public.playlists (user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- playlist_tracks: the songs inside one playlist.
-- Track metadata (title/artist/cover/duration) is snapshotted here, so a
-- playlist keeps working even if the catalog changes. There is deliberately
-- no shared "songs" table: nothing else has to exist for these rows to show.
-- ----------------------------------------------------------------------------
create table if not exists public.playlist_tracks (
    playlist_id uuid not null references public.playlists (id) on delete cascade,
    external_id text not null check (external_id ~ '^[A-Za-z0-9]{1,32}$'),
    title       text not null,
    artist      text not null default 'Unknown artist',
    cover       text,
    duration    integer not null default 0 check (duration >= 0),
    added_at    timestamptz not null default now(),
    primary key (playlist_id, external_id)
);

create index if not exists playlist_tracks_playlist_id_idx
    on public.playlist_tracks (playlist_id, added_at);

-- ----------------------------------------------------------------------------
-- favorites: one row per (user, liked track)
-- ----------------------------------------------------------------------------
create table if not exists public.favorites (
    user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
    external_id text not null check (external_id ~ '^[A-Za-z0-9]{1,32}$'),
    title       text not null,
    artist      text not null default 'Unknown artist',
    cover       text,
    duration    integer not null default 0 check (duration >= 0),
    created_at  timestamptz not null default now(),
    primary key (user_id, external_id)
);

create index if not exists favorites_user_id_idx
    on public.favorites (user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- listening_history: one row per play (newest first in every query)
-- ----------------------------------------------------------------------------
create table if not exists public.listening_history (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
    external_id text not null check (external_id ~ '^[A-Za-z0-9]{1,32}$'),
    title       text not null,
    artist      text not null default 'Unknown artist',
    cover       text,
    duration    integer not null default 0 check (duration >= 0),
    played_at   timestamptz not null default now()
);

create index if not exists listening_history_user_played_idx
    on public.listening_history (user_id, played_at desc);

-- ============================================================================
--  Row Level Security
--  Every user-owned table is locked down: a signed-in user can only ever see
--  and touch their own rows. Playlist rows are reached through the owning
--  playlist, so someone else's playlist id returns nothing at all.
-- ============================================================================
alter table public.profiles          enable row level security;
alter table public.playlists         enable row level security;
alter table public.playlist_tracks   enable row level security;
alter table public.favorites         enable row level security;
alter table public.listening_history enable row level security;

-- profiles -------------------------------------------------------------------
drop policy if exists "profiles are readable by signed-in users" on public.profiles;
create policy "profiles are readable by signed-in users"
    on public.profiles for select
    to authenticated
    using (true);

drop policy if exists "users can insert their own profile" on public.profiles;
create policy "users can insert their own profile"
    on public.profiles for insert
    to authenticated
    with check (auth.uid() = id);

drop policy if exists "users can update their own profile" on public.profiles;
create policy "users can update their own profile"
    on public.profiles for update
    to authenticated
    using (auth.uid() = id)
    with check (auth.uid() = id);

-- playlists ------------------------------------------------------------------
drop policy if exists "own playlists are readable" on public.playlists;
create policy "own playlists are readable"
    on public.playlists for select
    to authenticated
    using (auth.uid() = user_id);

drop policy if exists "own playlists can be created" on public.playlists;
create policy "own playlists can be created"
    on public.playlists for insert
    to authenticated
    with check (auth.uid() = user_id);

drop policy if exists "own playlists can be updated" on public.playlists;
create policy "own playlists can be updated"
    on public.playlists for update
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

drop policy if exists "own playlists can be deleted" on public.playlists;
create policy "own playlists can be deleted"
    on public.playlists for delete
    to authenticated
    using (auth.uid() = user_id);

-- playlist_tracks: ownership is the parent playlist's owner ---------------
drop policy if exists "playlist tracks follow the playlist owner" on public.playlist_tracks;
create policy "playlist tracks follow the playlist owner"
    on public.playlist_tracks for all
    to authenticated
    using (
        exists (
            select 1 from public.playlists p
            where p.id = playlist_tracks.playlist_id
              and p.user_id = auth.uid()
        )
    )
    with check (
        exists (
            select 1 from public.playlists p
            where p.id = playlist_tracks.playlist_id
              and p.user_id = auth.uid()
        )
    );

-- favorites -----------------------------------------------------------------
drop policy if exists "own favorites" on public.favorites;
create policy "own favorites"
    on public.favorites for all
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

-- listening_history ---------------------------------------------------------
drop policy if exists "own listening history" on public.listening_history;
create policy "own listening history"
    on public.listening_history for all
    to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- Privileges. Supabase grants these by default; repeating them here keeps the
-- app working even if the project's default privileges were ever narrowed.
-- RLS (above) is what actually protects the rows - not these grants.
-- ----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
alter default privileges in schema public
    grant select, insert, update, delete on tables to authenticated;

-- ----------------------------------------------------------------------------
-- profiles.email is stored but never broadcast. The blanket grant above would
-- let any signed-in user SELECT the whole column (harvesting every address),
-- so it is narrowed to the public profile fields only - RLS still decides
-- which rows, these grants decide which columns. Your OWN email is not read
-- from this table at all: GoTrue hands it to you in your session
-- (session.user.email) and only ever to you.
-- ----------------------------------------------------------------------------
revoke select on public.profiles from anon, authenticated;
grant select (id, username, role, created_at) on public.profiles to anon, authenticated;

-- ============================================================================
--  Migrating data from the old PHP/MySQL project (one-time, optional)
-- ============================================================================
--  Nothing above reads from MySQL and nothing ever deletes or overwrites
--  existing rows, so you can run this script on a project that already has
--  data. The PHP app stored: 1 user account, listening history, and (if you
--  used them) playlists and favorites - plus a `songs` table of local uploads.
--
--  To carry the data over:
--
--  1. EXPORT from MySQL (XAMPP), one query per table:
--       SELECT id, username, created_at            FROM users;
--       SELECT user_id, song_id, created_at        FROM favorites;
--       SELECT user_id, song_id, played_at         FROM listening_history;
--       SELECT id, user_id, name, created_at       FROM playlists;
--       SELECT playlist_id, song_id, ...           FROM playlist_tracks;
--     Every `song_id` maps to `external_id` (the Audius track id) and the
--     title/artist/cover/duration are copied onto the row itself, so the old
--     `songs` table does NOT need to exist in Supabase.
--
--  2. ACCOUNTS: Supabase keeps bcrypt hashes in auth.users. The old PHP
--     passwords are bcrypt too, so they can be imported ONCE using the
--     service_role key from a one-off script (never from the browser):
--       supabase.auth.admin.createUser({
--         email, password_hash, email_confirm: true, user_metadata: { username }
--       })
--     VERIFY this with the single existing account before doing anything
--     else, and delete the script afterwards. Simpler alternative: users
--     just register again in the new app (the profile trigger then creates
--     their row automatically).
--
--  3. ROWS: favorites / playlists / playlist_tracks / listening_history all
--     need `user_id` = that user's auth uid. RLS requires auth.uid() =
--     user_id, so import them either as the signed-in user or from a one-off
--     script using the service_role key (which bypasses RLS).
--
--  4. Never put the service_role key in Vercel's public env vars or in this
--     repository - it bypasses every policy above.
-- ============================================================================
