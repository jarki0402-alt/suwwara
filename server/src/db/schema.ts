// Inlined (not a separate .sql asset file) because the Docker build only
// copies `dist/` (tsc output) into the runtime image — a sibling .sql file
// wouldn't survive that copy. Applied idempotently on server boot, see migrate().
export const SCHEMA_SQL = `
create table if not exists accounts (
  id text primary key,
  created_at timestamptz not null default now()
);

-- A device is identified by the random id it generates for itself on first
-- launch (src/auth/deviceIdentity.ts) and sends back as a bearer token.
-- Pairing a second device just repoints its row's account_id to an existing
-- account — see server/src/pairing/pairingManager.ts.
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
-- normalized into per-song/per-playlist rows — at this app's scale (a closed
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
`;
