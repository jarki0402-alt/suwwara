import { sql } from '../db/client';
import { onShutdown } from '../shutdown';
import {
  ROOM_IDLE_TTL_MS,
  requeueDirty,
  restoreRoom,
  takeDirtyRooms,
  takeRemovedRoomIds,
  takeTouchedRooms,
  type PersistedRoom,
} from './roomManager';
import type { RoomQueueState, RoomTransportState } from './types';

/**
 * Keeps Jam rooms in Postgres so a restart does not end every Jam. roomManager stays the source of truth in memory (it
 * also runs in tests without a database) and only marks what changed; this file writes those marks in one batch every
 * FLUSH_MS. A skip during a Jam is a handful of intents in a second, so writing per intent would be several rewrites of
 * the whole queue for nothing. Losing the last couple of seconds to a hard kill is fine: the room comes back a step behind
 * at worst, never gone.
 */
const FLUSH_MS = 2000;

let flushing = false;

export async function flushJamRooms(): Promise<void> {
  if (flushing) return;
  flushing = true;
  const removed = takeRemovedRoomIds();
  const dirty = takeDirtyRooms();
  const touched = takeTouchedRooms();
  try {
    if (removed.length > 0) await sql`delete from jam_rooms where room_id in ${sql(removed)}`;
    for (const room of dirty) {
      await sql`
        insert into jam_rooms (room_id, creator_client_id, queue_state, transport_state, participants, last_auto_advance_at, last_activity_at)
        values (${room.roomId}, ${room.creatorClientId}, ${sql.json(room.queueState as never)}, ${sql.json(room.transportState as never)},
                ${sql.json(room.participants as never)}, ${room.lastAutoAdvanceAt}, ${room.lastActivityAt})
        on conflict (room_id) do update set
          queue_state = excluded.queue_state,
          transport_state = excluded.transport_state,
          participants = excluded.participants,
          last_auto_advance_at = excluded.last_auto_advance_at,
          last_activity_at = excluded.last_activity_at`;
    }
    for (const [roomId, lastActivityAt] of touched) {
      await sql`update jam_rooms set last_activity_at = ${lastActivityAt} where room_id = ${roomId}`;
    }
  } catch {
    // Postgres briefly unreachable: try these rooms again on the next tick instead of dropping the change.
    requeueDirty([...dirty.map((room) => room.roomId), ...touched.map(([roomId]) => roomId)]);
  } finally {
    flushing = false;
  }
}

interface JamRoomRow {
  room_id: string;
  creator_client_id: string;
  queue_state: RoomQueueState;
  transport_state: RoomTransportState;
  participants: string[];
  last_auto_advance_at: string | number;
  last_activity_at: string | number;
}

/** Called once at boot, after migrate(): rooms still within their idle window come back; older ones are deleted. */
export async function loadJamRooms(): Promise<void> {
  const cutoff = Date.now() - ROOM_IDLE_TTL_MS;
  try {
    await sql`delete from jam_rooms where last_activity_at < ${cutoff}`;
    const rows = await sql<JamRoomRow[]>`select * from jam_rooms`;
    for (const row of rows) {
      const stored: PersistedRoom = {
        roomId: row.room_id,
        creatorClientId: row.creator_client_id,
        queueState: row.queue_state,
        transportState: row.transport_state,
        participants: Array.isArray(row.participants) ? row.participants : [],
        lastAutoAdvanceAt: Number(row.last_auto_advance_at) || 0,
        lastActivityAt: Number(row.last_activity_at) || Date.now(),
      };
      restoreRoom(stored);
    }
  } catch {
    // A failed restore only means old Jams do not come back; the server must still start.
  }
}

setInterval(() => void flushJamRooms(), FLUSH_MS).unref();
onShutdown(flushJamRooms);
