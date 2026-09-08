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
`;
