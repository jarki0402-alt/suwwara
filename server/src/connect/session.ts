import { sql } from '../db/client';

/**
 * The account's playback session — the running queue and where it is — shared by every device of the account, the way
 * Spotify keeps one "now playing" per account. Stored in Postgres only (nothing cached in memory here: one row per
 * account, read on a device's boot and written when the queue or the song changes).
 */
export interface SessionCursor {
  queueRev: string;
  order: number[];
  position: number;
  repeatMode: 'off' | 'all' | 'one';
  shuffle: boolean;
  songId: string | null;
  /** Absent from a remote's edit: a remote doesn't know the playhead; the server keeps (or resets, on a new song) its own. */
  positionSec: number | null;
  isPlaying: boolean | null;
  /** Which device plays this session. Absent = the sender itself. */
  activeRef: string | null;
}

export interface SessionUpdate {
  cursor: SessionCursor;
  /** Only sent when the queue itself changed; otherwise the stored queue with the same queueRev stays. */
  queue: unknown[] | null;
}

export interface StoredSession extends Omit<SessionCursor, 'positionSec' | 'isPlaying'> {
  queue?: unknown[];
  positionSec: number;
  isPlaying: boolean;
  updatedAt: number;
}

// Matches the client's MAX_QUEUE_LENGTH. The byte cap is what bounds a row (and the SSE fan-out of it) whatever the songs carry.
const MAX_QUEUE_LENGTH = 200;
const MAX_QUEUE_BYTES = 600_000;
const REPEAT_MODES = new Set(['off', 'all', 'one']);

const isIndex = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < MAX_QUEUE_LENGTH;
const shortString = (value: unknown, max: number): string | null => (typeof value === 'string' && value.length > 0 && value.length <= max ? value : null);

export function sanitizeSessionUpdate(body: unknown): SessionUpdate | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const queueRev = shortString(b.queueRev, 40);
  if (!queueRev || !Array.isArray(b.order) || b.order.length > MAX_QUEUE_LENGTH || !b.order.every(isIndex)) return null;
  if (!isIndex(b.position)) return null;

  let queue: unknown[] | null = null;
  if (b.queue !== undefined) {
    if (!Array.isArray(b.queue) || b.queue.length > MAX_QUEUE_LENGTH) return null;
    if (!b.queue.every((song) => song && typeof song === 'object' && typeof (song as { id?: unknown }).id === 'string')) return null;
    if (JSON.stringify(b.queue).length > MAX_QUEUE_BYTES) return null;
    queue = b.queue;
  }

  const positionSec = typeof b.positionSec === 'number' && Number.isFinite(b.positionSec) ? Math.max(0, b.positionSec) : null;
  return {
    queue,
    cursor: {
      queueRev,
      order: b.order as number[],
      position: b.position as number,
      repeatMode: REPEAT_MODES.has(b.repeatMode as string) ? (b.repeatMode as SessionCursor['repeatMode']) : 'off',
      shuffle: b.shuffle === true,
      songId: shortString(b.songId, 40),
      positionSec,
      isPlaying: typeof b.isPlaying === 'boolean' ? b.isPlaying : null,
      activeRef: shortString(b.activeRef, 40),
    },
  };
}

interface Row {
  queue: unknown[];
  queue_rev: string;
  play_order: number[];
  position: number;
  repeat_mode: SessionCursor['repeatMode'];
  shuffle: boolean;
  song_id: string | null;
  position_sec: number;
  is_playing: boolean;
  active_ref: string | null;
  updated_at: string;
}

/** The stored session, without the queue when the caller already holds that revision of it. */
export async function loadSession(accountId: string, haveRev: string | null): Promise<StoredSession | null> {
  const [row] = await sql<Row[]>`select * from playback_sessions where account_id = ${accountId}`;
  if (!row) return null;
  return {
    ...(row.queue_rev === haveRev ? {} : { queue: row.queue }),
    queueRev: row.queue_rev,
    order: row.play_order,
    position: row.position,
    repeatMode: row.repeat_mode,
    shuffle: row.shuffle,
    songId: row.song_id,
    positionSec: row.position_sec,
    isPlaying: row.is_playing,
    activeRef: row.active_ref,
    updatedAt: Number(row.updated_at),
  };
}

/**
 * Writes an update and returns its new version, or null when it named a queue revision the server doesn't have (the
 * sender then resends with the queue). A new song with no playhead of its own starts at 0; the same song keeps its spot.
 */
export async function saveSession(accountId: string, senderRef: string, { cursor, queue }: SessionUpdate): Promise<number | null> {
  const now = Date.now();
  const activeRef = cursor.activeRef ?? senderRef;
  const order = sql.json(cursor.order as never);
  if (queue) {
    const [row] = await sql<{ updated_at: string }[]>`
      insert into playback_sessions (account_id, queue, queue_rev, play_order, position, repeat_mode, shuffle, song_id, position_sec, is_playing, active_ref, updated_at)
      values (${accountId}, ${sql.json(queue as never)}, ${cursor.queueRev}, ${order}, ${cursor.position}, ${cursor.repeatMode}, ${cursor.shuffle},
        ${cursor.songId}, ${cursor.positionSec ?? 0}, ${cursor.isPlaying ?? false}, ${activeRef}, ${now})
      on conflict (account_id) do update set
        queue = excluded.queue, queue_rev = excluded.queue_rev, play_order = excluded.play_order, position = excluded.position,
        repeat_mode = excluded.repeat_mode, shuffle = excluded.shuffle, song_id = excluded.song_id,
        position_sec = case when ${cursor.positionSec}::real is not null then ${cursor.positionSec}::real
          when playback_sessions.song_id is distinct from excluded.song_id then 0 else playback_sessions.position_sec end,
        is_playing = coalesce(${cursor.isPlaying}::boolean, playback_sessions.is_playing),
        active_ref = excluded.active_ref, updated_at = greatest(playback_sessions.updated_at + 1, excluded.updated_at)
      returning updated_at
    `;
    return Number(row.updated_at);
  }
  const [row] = await sql<{ updated_at: string }[]>`
    update playback_sessions set
      play_order = ${order}, position = ${cursor.position}, repeat_mode = ${cursor.repeatMode}, shuffle = ${cursor.shuffle},
      position_sec = case when ${cursor.positionSec}::real is not null then ${cursor.positionSec}::real
        when song_id is distinct from ${cursor.songId} then 0 else position_sec end,
      is_playing = coalesce(${cursor.isPlaying}::boolean, is_playing),
      song_id = ${cursor.songId}, active_ref = ${activeRef}, updated_at = greatest(updated_at + 1, ${now})
    where account_id = ${accountId} and queue_rev = ${cursor.queueRev}
    returning updated_at
  `;
  return row ? Number(row.updated_at) : null;
}

/** The playing device's periodic "I'm here now" — kept apart from the version so it never reads as news to others. */
export async function saveSessionPosition(accountId: string, songId: string, positionSec: number, isPlaying: boolean): Promise<void> {
  await sql`
    update playback_sessions set position_sec = ${positionSec}, is_playing = ${isPlaying}
    where account_id = ${accountId} and song_id = ${songId}
  `;
}
