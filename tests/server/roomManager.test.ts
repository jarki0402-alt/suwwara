// These import backend code (server/src), which the frontend Docker build context does
// not contain (see .dockerignore), so tests/server is excluded from `tsc -b`
// (tsconfig.vitest.json) and only run by Vitest. Type-check them ad hoc with:
//   npx tsc --noEmit --strict --module esnext --moduleResolution bundler --target es2022 \
//     --skipLibCheck --types node,vitest/globals tests/server/*.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Response } from 'express';
import {
  addMember,
  applyIntent,
  closeRoom,
  createRoom,
  getSnapshot,
  isMember,
  joinRoom,
  removeConnection,
  removeMember,
  restoreRoom,
  takeDirtyRooms,
  takeRemovedRoomIds,
} from '../../server/src/jam/roomManager';
import type { RoomQueueState } from '../../server/src/jam/types';

const queue = (ids: string[], overrides: Partial<RoomQueueState> = {}): RoomQueueState => ({
  queue: ids.map((id) => ({ id })),
  order: ids.map((_, index) => index),
  position: 0,
  repeatMode: 'off',
  shuffle: false,
  ...overrides,
});

describe('jam room transport (server clock)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('projects the playhead forward for someone joining mid-song', () => {
    const roomId = createRoom('creator', queue(['a', 'b']));
    applyIntent(roomId, { type: 'play' });

    vi.advanceTimersByTime(90_000); // the song has been playing for 90s, nobody sent a heartbeat

    const snapshot = getSnapshot(roomId)!;
    expect(snapshot.isPlaying).toBe(true);
    expect(snapshot.positionSec).toBeCloseTo(90, 0);
  });

  it('does not move the playhead while paused', () => {
    const roomId = createRoom('creator', queue(['a']));
    applyIntent(roomId, { type: 'play' });
    vi.advanceTimersByTime(30_000);
    applyIntent(roomId, { type: 'pause' });
    vi.advanceTimersByTime(600_000);

    expect(getSnapshot(roomId)!.positionSec).toBeCloseTo(30, 0);
  });

  it('resumes from where it was paused, not from the last seek', () => {
    const roomId = createRoom('creator', queue(['a']));
    applyIntent(roomId, { type: 'play' });
    vi.advanceTimersByTime(60_000);
    applyIntent(roomId, { type: 'pause' });
    applyIntent(roomId, { type: 'play' });
    vi.advanceTimersByTime(5_000);

    expect(getSnapshot(roomId)!.positionSec).toBeCloseTo(65, 0);
  });
});

describe('jam advance-on-ended dedupe', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('collapses simultaneous end-of-track reports from several devices into one advance', () => {
    const roomId = createRoom('creator', queue(['a', 'b', 'c']));
    applyIntent(roomId, { type: 'advance-on-ended', payload: { songId: 'a' } });
    applyIntent(roomId, { type: 'advance-on-ended', payload: { songId: 'a' } });
    applyIntent(roomId, { type: 'advance-on-ended', payload: { songId: 'a' } });

    expect(getSnapshot(roomId)!.position).toBe(1);
  });

  it('ignores a slow device reporting a song that has already been advanced past', () => {
    const roomId = createRoom('creator', queue(['a', 'b', 'c']));
    applyIntent(roomId, { type: 'advance-on-ended', payload: { songId: 'a' } });
    vi.advanceTimersByTime(10_000); // well outside any short time window

    applyIntent(roomId, { type: 'advance-on-ended', payload: { songId: 'a' } }); // late report about 'a'
    expect(getSnapshot(roomId)!.position).toBe(1); // still on 'b' — a time-only window would have skipped it
  });

  it('still lets repeat-one replay the same song after it really ends again', () => {
    const roomId = createRoom('creator', queue(['a'], { repeatMode: 'one' }));
    applyIntent(roomId, { type: 'advance-on-ended', payload: { songId: 'a' } });
    vi.advanceTimersByTime(200_000);
    applyIntent(roomId, { type: 'advance-on-ended', payload: { songId: 'a' } });

    const snapshot = getSnapshot(roomId)!;
    expect(snapshot.position).toBe(0);
    expect(snapshot.isPlaying).toBe(true);
    expect(snapshot.positionSec).toBeCloseTo(0, 0);
  });
});

describe('jam play-next intent', () => {
  it('slots the song in right after the one playing, for everyone in the room', () => {
    const roomId = createRoom('creator', queue(['a', 'b', 'c']));
    applyIntent(roomId, { type: 'play-next', payload: { song: { id: 'x' } } });
    const snapshot = getSnapshot(roomId);
    expect(snapshot?.order.map((index) => snapshot.queue[index].id)).toEqual(['a', 'x', 'b', 'c']);
    expect(snapshot?.position).toBe(0);
  });
});

describe('jam membership survives reconnects', () => {
  const stream = () => {
    let ended = false;
    const res = { write: () => true, end: () => void (ended = true) } as unknown as Response;
    return { res, isEnded: () => ended };
  };

  it('keeps a device in the room when its old stream closes after the new one opened', () => {
    const roomId = createRoom('host', queue(['a']));
    const first = stream();
    const second = stream();
    addMember(roomId, 'guest', first.res);
    addMember(roomId, 'guest', second.res); // reconnected before the server noticed the first one was dead
    removeConnection(roomId, 'guest', first.res); // the late close of the dead stream

    expect(getSnapshot(roomId)!.memberCount).toBe(1);
    expect(isMember(roomId, 'guest')).toBe(true);
  });

  it('still accepts actions from a device that is between streams', () => {
    const roomId = createRoom('host', queue(['a', 'b']));
    const only = stream();
    addMember(roomId, 'guest', only.res);
    removeConnection(roomId, 'guest', only.res); // phone asleep, stream gone

    expect(getSnapshot(roomId)!.memberCount).toBe(0);
    expect(isMember(roomId, 'guest')).toBe(true);
  });

  it('lets a device act right after joining, before its stream is open', () => {
    const roomId = createRoom('host', queue(['a']));
    expect(isMember(roomId, 'guest')).toBe(false);
    expect(joinRoom(roomId, 'guest')).toBe(true);
    expect(isMember(roomId, 'guest')).toBe(true);
  });

  it('takes a device out only when it presses Keluar', () => {
    const roomId = createRoom('host', queue(['a']));
    addMember(roomId, 'guest', stream().res);
    removeMember(roomId, 'guest');
    expect(isMember(roomId, 'guest')).toBe(false);
  });

  it('caps how many streams one device can hold, ending the oldest', () => {
    const roomId = createRoom('host', queue(['a']));
    const streams = Array.from({ length: 5 }, () => stream());
    streams.forEach((item) => addMember(roomId, 'guest', item.res));
    expect(streams.filter((item) => item.isEnded())).toHaveLength(2);
    expect(getSnapshot(roomId)!.memberCount).toBe(1);
  });
});

describe('jam rooms survive a restart', () => {
  it('hands changed rooms to the store and brings a stored room back', () => {
    takeDirtyRooms(); // drop marks from earlier tests
    const roomId = createRoom('host', queue(['a', 'b']));
    joinRoom(roomId, 'guest');
    applyIntent(roomId, { type: 'next' });

    const stored = takeDirtyRooms().find((room) => room.roomId === roomId)!;
    expect(stored.queueState.position).toBe(1);
    expect(stored.participants).toEqual(['host', 'guest']);
    expect(takeDirtyRooms()).toEqual([]); // cleared on read

    closeRoom(roomId, 'test');
    expect(takeRemovedRoomIds()).toContain(roomId);
    expect(getSnapshot(roomId)).toBeNull();

    restoreRoom(stored); // the server came back
    expect(getSnapshot(roomId)!.position).toBe(1);
    expect(isMember(roomId, 'guest')).toBe(true);
  });
});

describe('jam room start', () => {
  it('starts from the host playback instead of always paused at 0:00', () => {
    const roomId = createRoom('host', queue(['a']), { isPlaying: true, positionSec: 42 });
    const snapshot = getSnapshot(roomId)!;
    expect(snapshot.isPlaying).toBe(true);
    expect(snapshot.positionSec).toBeGreaterThanOrEqual(42);
  });

  it('still starts paused when an older client sends no playback', () => {
    expect(getSnapshot(createRoom('host', queue(['a'])))!.isPlaying).toBe(false);
  });
});
