// Imports backend code (server/src) — see the note in tests/server/priorityLimiter.test.ts.
import { describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';

// session.ts talks to Postgres; only its validation is under test here.
vi.mock('../../server/src/db/client', () => ({ sql: {} }));

const { sanitizeSessionUpdate } = await import('../../server/src/connect/session');
const { broadcastSession, connectDevice } = await import('../../server/src/connect/connectHub');

const song = (id: string) => ({ id, name: id, duration: 200 });
const base = { queueRev: 'r1', order: [0, 1], position: 1, repeatMode: 'all', shuffle: true, songId: 'b' };

describe('sanitizeSessionUpdate', () => {
  it('accepts a cursor-only update and keeps an omitted playhead as "unknown"', () => {
    const update = sanitizeSessionUpdate(base);
    expect(update?.queue).toBeNull();
    expect(update?.cursor).toMatchObject({ queueRev: 'r1', order: [0, 1], position: 1, repeatMode: 'all', shuffle: true, songId: 'b', positionSec: null, isPlaying: null, activeRef: null });
  });

  it('carries the queue and the playhead when sent', () => {
    const update = sanitizeSessionUpdate({ ...base, queue: [song('a'), song('b')], positionSec: 42.5, isPlaying: true, activeRef: 'mac' });
    expect(update?.queue).toHaveLength(2);
    expect(update?.cursor).toMatchObject({ positionSec: 42.5, isPlaying: true, activeRef: 'mac' });
  });

  it('refuses malformed or oversized updates', () => {
    expect(sanitizeSessionUpdate(null)).toBeNull();
    expect(sanitizeSessionUpdate({ ...base, queueRev: '' })).toBeNull();
    expect(sanitizeSessionUpdate({ ...base, order: [0, -1] })).toBeNull();
    expect(sanitizeSessionUpdate({ ...base, position: 1.5 })).toBeNull();
    expect(sanitizeSessionUpdate({ ...base, queue: [{ name: 'no id' }] })).toBeNull();
    expect(sanitizeSessionUpdate({ ...base, queue: Array.from({ length: 201 }, (_, i) => song(`s${i}`)) })).toBeNull();
    expect(sanitizeSessionUpdate({ ...base, queue: [{ id: 'x', blob: 'x'.repeat(700_000) }] })).toBeNull();
  });

  it('falls back to repeat "off" for an unknown mode', () => {
    expect(sanitizeSessionUpdate({ ...base, repeatMode: 'twice' })?.cursor.repeatMode).toBe('off');
  });
});

describe('broadcastSession', () => {
  it('reaches every other device of the account, never the sender or another account', () => {
    const writesOf = () => {
      const writes: string[] = [];
      const res = { write: (chunk: string) => (writes.push(chunk), true), end: () => {} } as unknown as Response;
      return { res, writes };
    };
    const phone = writesOf();
    const mac = writesOf();
    const stranger = writesOf();
    connectDevice('session-acct', 'phone', 'iPhone', 'phone', phone.res);
    connectDevice('session-acct', 'mac', 'Mac', 'desktop', mac.res);
    connectDevice('other-acct', 'x', 'X', 'desktop', stranger.res);

    broadcastSession('session-acct', 'phone', { updatedAt: 1, queueRev: 'r1' });
    const sessionEvents = (writes: string[]) => writes.filter((chunk) => chunk.startsWith('event: session'));
    expect(sessionEvents(mac.writes)).toHaveLength(1);
    expect(sessionEvents(phone.writes)).toHaveLength(0);
    expect(sessionEvents(stranger.writes)).toHaveLength(0);
  });
});
