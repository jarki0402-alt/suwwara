// Inlined (not a separate .sql asset file) because the Docker build only
// copies `dist/` (tsc output) into the runtime image - a sibling .sql file
// wouldn't survive that copy. Applied idempotently on server boot, see migrate().
export const SCHEMA_SQL = `
create table if not exists accounts (
  id text primary key,
  created_at timestamptz not null default now()
);

-- A device is identified by the random id it generates for itself on first
-- launch (src/auth/deviceIdentity.ts) and sends back as a bearer token.
-- Pairing a second device just repoints its row's account_id to an existing
-- account - see server/src/pairing/pairingManager.ts.
create table if not exists devices (
  device_id text primary key,
  account_id text not null references accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- Shown in the linked-devices list (Settings -> Perangkat). Idempotent so an existing
-- database picks them up on the next boot.
alter table devices add column if not exists name text;
alter table devices add column if not exists kind text;

-- One row per account: the whole liked-songs + playlists snapshot, mirroring
-- the shape already used by src/stores/libraryStore.ts. Deliberately not
-- normalized into per-song/per-playlist rows - at this app's scale (a closed
-- circle, a few hundred songs at most) a whole-snapshot jsonb write-through is
-- simpler to reason about than incremental row sync, and the client already
-- treats the whole thing as one persisted blob (Zustand \`persist\`).
create table if not exists library_snapshots (
  account_id text primary key references accounts(id) on delete cascade,
  liked_songs jsonb not null default '[]',
  playlists jsonb not null default '[]',
  updated_at timestamptz not null default now()
);

-- Bumped on every write. Lets a device ask "anything newer than what I have?" without
-- downloading the whole snapshot, and lets a write be rejected when someone else changed
-- the library since this device last saw it (see routes/library.ts).
alter table library_snapshots add column if not exists version bigint not null default 0;

-- Replaces the in-memory Map cache that used to live in youtube/stream.ts.
-- Moving it here means a redeploy/restart doesn't throw away every
-- already-resolved link.
create table if not exists audio_cache (
  video_id text not null,
  quality text not null,
  url text not null,
  mime_type text not null,
  http_headers jsonb,
  expires_at timestamptz not null,
  primary key (video_id, quality)
);

-- Lyrics found for a video, so a song is looked up upstream once for everyone instead of on every play of
-- every device. expires_at is a refresh time, not a delete time: an expired row is still served if the
-- refresh fails (see youtube/lyrics.ts). Rows are pruned by count and age, never left to grow unbounded.
create table if not exists lyrics_cache (
  video_id text primary key,
  type text not null,
  source text,
  synced text,
  plain text,
  matched_duration_sec real,
  expires_at timestamptz not null,
  fetched_at timestamptz not null default now()
);
create index if not exists lyrics_cache_fetched_idx on lyrics_cache (fetched_at);

-- Login (username + password). Every account that can use the app has exactly one user row; an account without one
-- (an old anonymous device account) can no longer sign in. Accounts are created by the admin, never by visitors.
create table if not exists users (
  account_id text primary key references accounts(id) on delete cascade,
  username text not null unique,
  password_hash text not null,
  role text not null default 'user',
  disabled boolean not null default false,
  must_change_password boolean not null default false,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

-- One row per signed-in browser/PWA. Only the SHA-256 of the cookie token is stored, so a database leak cannot be
-- replayed as a session. Pruned when expired.
create table if not exists sessions (
  token_hash text primary key,
  account_id text not null references accounts(id) on delete cascade,
  user_agent text,
  ip text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists sessions_account_idx on sessions (account_id);

-- Sign-ins (ok / failed / locked) and admin actions, for the admin dashboard. Kept 90 days, see auth/audit.ts.
create table if not exists audit_log (
  id bigserial primary key,
  at timestamptz not null default now(),
  event text not null,
  account_id text,
  username text,
  ip text,
  detail text
);
create index if not exists audit_log_at_idx on audit_log (at);

-- What makes the home page look the same on every device of an account: the play history that feeds the
-- recommendations, and the current daily/weekly mixes (which every device would otherwise generate differently).
-- Merged on the server (see library/profileMerge.ts), so a write never needs a version number.
create table if not exists profiles (
  account_id text primary key references accounts(id) on delete cascade,
  history jsonb not null default '[]',
  cleared_at bigint not null default 0,
  weekly jsonb,
  daily jsonb,
  updated_at timestamptz not null default now()
);
-- Pengaturan → Bahasa, synced like the rest of the profile (2026-11).
alter table profiles add column if not exists language jsonb;

-- Bandwidth per account per day: bytes the backend sent as audio, and how many audio requests. Counts only; never WHAT
-- was played. Flushed from memory once a minute (metrics/usage.ts) and pruned after 400 days.
create table if not exists usage_daily (
  account_id text not null references accounts(id) on delete cascade,
  day date not null,
  audio_bytes bigint not null default 0,
  audio_requests integer not null default 0,
  primary key (account_id, day)
);
create index if not exists usage_daily_day_idx on usage_daily (day);
-- Links resolved while yt-dlp could only get YouTube's 360p video+audio file (itag 18): dropped so the next play
-- resolves the audio-only m4a. Only links that would be re-resolved within hours anyway; harmless to run again.
delete from audio_cache where url ~ '[?&]itag=18(&|$)';
-- Music videos (Now Playing → Video), kept apart from audio so the dashboard shows what the feature costs (2026-11).
alter table usage_daily add column if not exists video_bytes bigint not null default 0;

-- The account's one playback session (Spotify Connect): the running queue and where it is, whichever device plays it.
-- One small row per account, so a phone opened after the laptop was closed can carry on from the same spot. The queue
-- column is only rewritten when the queue itself changes (queue_rev), never on a skip or a position save.
-- updated_at is a server-assigned millisecond version (monotonic per account) that devices compare to drop stale news.
create table if not exists playback_sessions (
  account_id text primary key references accounts(id) on delete cascade,
  queue jsonb not null default '[]',
  queue_rev text not null default '',
  play_order jsonb not null default '[]',
  position integer not null default 0,
  repeat_mode text not null default 'off',
  shuffle boolean not null default false,
  song_id text,
  position_sec real not null default 0,
  is_playing boolean not null default false,
  active_ref text,
  updated_at bigint not null default 0
);

-- Open Jam rooms, so a backend restart (a deploy, or the 1GB VM killing the process for memory) no longer throws every
-- listener out with "Jam sudah berakhir". Live streams are not stored: devices reconnect on their own. Written in batches
-- from memory every few seconds (jam/roomStore.ts); rows idle past the room TTL are deleted on boot and by the room GC.
create table if not exists jam_rooms (
  room_id text primary key,
  creator_client_id text not null,
  queue_state jsonb not null,
  transport_state jsonb not null,
  participants jsonb not null default '[]',
  last_auto_advance_at bigint not null default 0,
  last_activity_at bigint not null
);

-- Spotify import (importer/importWorker.ts). The matching (one YT Music search per song, paced) takes minutes for a
-- big library, so it runs here in the background instead of in the browser: it carries on when the app is closed and
-- resumes after a restart. One row per unique track (an ISRC can sit in several playlists) and the playlists as lists
-- of those keys. Rows are deleted a few days after the import ends; nothing here is needed once the client has the songs.
create table if not exists spotify_imports (
  id text primary key,
  account_id text not null references accounts(id) on delete cascade,
  status text not null default 'running',
  playlists jsonb not null,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists spotify_imports_account on spotify_imports (account_id, created_at desc);

create table if not exists spotify_import_tracks (
  import_id text not null references spotify_imports(id) on delete cascade,
  key text not null,
  position integer not null,
  name text not null,
  artists jsonb not null,
  duration_sec integer not null,
  status text not null default 'pending',
  song jsonb,
  primary key (import_id, key)
);
create index if not exists spotify_import_tracks_pending on spotify_import_tracks (import_id, position) where status = 'pending';

-- Shared across accounts on purpose: friends' libraries overlap, and a song matched once never costs a search again.
-- Keyed by ISRC (or the Spotify URI when a track has none). On disk, not in RAM.
create table if not exists spotify_track_matches (
  key text primary key,
  verdict text not null,
  song jsonb,
  matched_at timestamptz not null default now()
);

-- Podcast tab (routes/podcast.ts). Per account and small, so plain rows written one at a time (follow, a saved
-- position every ~15s while listening) instead of a whole synced snapshot like the library. The episode's display data
-- rides along as jsonb so "Lanjutkan" and "Simpan" render without asking YouTube again.
create table if not exists podcast_follows (
  account_id text not null references accounts(id) on delete cascade,
  channel_id text not null,
  name text not null,
  avatar text not null default '',
  followed_at timestamptz not null default now(),
  primary key (account_id, channel_id)
);

create table if not exists podcast_progress (
  account_id text not null references accounts(id) on delete cascade,
  video_id text not null,
  position_sec real not null,
  duration_sec real not null,
  finished boolean not null default false,
  episode jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (account_id, video_id)
);
create index if not exists podcast_progress_recent on podcast_progress (account_id, updated_at desc);

create table if not exists podcast_saved (
  account_id text not null references accounts(id) on delete cascade,
  video_id text not null,
  episode jsonb not null,
  saved_at timestamptz not null default now(),
  primary key (account_id, video_id)
);

-- Chapters + transcript per episode, read once through yt-dlp (the same single slot as audio) and kept: they don't
-- change. Pruned by age and count (podcast/extras.ts).
create table if not exists podcast_extras (
  video_id text primary key,
  chapters jsonb not null,
  transcript jsonb,
  fetched_at timestamptz not null default now()
);

-- The admin's picks shown to everyone on the Podcast tab ("Pilihan").
create table if not exists podcast_picks (
  channel_id text primary key,
  name text not null,
  avatar text not null default '',
  subscribers text not null default '',
  position integer not null default 0,
  added_at timestamptz not null default now()
);

-- Usage per account per hour and kind (song / podcast / video), for the admin console (2026-11). Same rule as
-- usage_daily: counts, sizes and seconds only, never WHICH song or episode. bytes/requests/disk_bytes come from the
-- server's own streams; listen_sec and the play counts are reported by the device, because songs kept on the phone
-- ("Simpan lagu") play without reaching the server at all. Kept 90 days (metrics/usage.ts), usage_daily keeps 400.
create table if not exists usage_hourly (
  account_id text not null references accounts(id) on delete cascade,
  hour timestamptz not null,
  kind text not null,
  bytes bigint not null default 0,
  requests integer not null default 0,
  disk_bytes bigint not null default 0,
  listen_sec integer not null default 0,
  started integer not null default 0,
  completed integer not null default 0,
  skipped integer not null default 0,
  primary key (account_id, hour, kind)
);
create index if not exists usage_hourly_hour_idx on usage_hourly (hour);
-- First boot with the table: the bytes counted per day so far are carried over (at midday WIB, as songs: the podcast
-- tab had existed for two days), so the charts don't start empty. Only while the table is still empty, so never twice.
insert into usage_hourly (account_id, hour, kind, bytes, requests)
select account_id, hour, kind, bytes, requests from (
  select account_id, (day + time '12:00') at time zone 'Asia/Jakarta' as hour, 'song' as kind, audio_bytes as bytes, audio_requests as requests
  from usage_daily where day > current_date - 90 and audio_bytes > 0
  union all
  select account_id, (day + time '12:00') at time zone 'Asia/Jakarta', 'video', video_bytes, 0
  from usage_daily where day > current_date - 90 and video_bytes > 0
) carried
where not exists (select 1 from usage_hourly);

-- The VM every 5 minutes (metrics/systemSamples.ts), so the Sistem tab can show last night, not only the 30 minutes
-- the console happened to be open. ~4000 small rows at 14 days.
create table if not exists system_samples (
  at timestamptz primary key,
  ram_used_bytes bigint not null,
  ram_total_bytes bigint not null,
  swap_used_bytes bigint not null,
  load1 real not null,
  cpus smallint not null,
  disk_used_bytes bigint,
  disk_total_bytes bigint,
  rss_bytes bigint not null,
  cache_files integer,
  cache_bytes bigint,
  db_bytes bigint,
  resolves integer not null default 0,
  resolve_failures integer not null default 0,
  resolve_avg_ms integer,
  queue_pending smallint not null default 0
);
`;
