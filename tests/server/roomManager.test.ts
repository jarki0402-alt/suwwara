// These import backend code (server/src), which the frontend Docker build context does
// not contain (see .dockerignore), so tests/server is excluded from `tsc -b`
// (tsconfig.vitest.json) and only run by Vitest. Type-check them ad hoc with:
//   npx tsc --noEmit --strict --module esnext --moduleResolution bundler --target es2022 \
//     --skipLibCheck --types node,vitest/globals tests/server/*.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyIntent, createRoom, getSnapshot } from '../../server/src/jam/roomManager';
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
