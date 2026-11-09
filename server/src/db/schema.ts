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
`;
