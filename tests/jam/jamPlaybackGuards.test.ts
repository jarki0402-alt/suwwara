import { describe, expect, it } from 'vitest';
import { canSyncToRoom, catchUpTarget, isLoadStillCurrent, roomPositionSec } from '../../src/jam/jamPlaybackGuards';
import type { JamPlaybackMeta } from '../../src/stores/jamStore';

const meta = (over: Partial<JamPlaybackMeta> = {}): JamPlaybackMeta => ({ isPlaying: true, positionSec: 0, lastUpdatedAtMs: 1_000_000, ...over });

describe('roomPositionSec', () => {
  it('rolls the position forward by the time since the state arrived while playing', () => {
    expect(roomPositionSec(meta({ positionSec: 10 }), 1_004_000)).toBeCloseTo(14);
  });
  it('holds still while the room is paused', () => {
    expect(roomPositionSec(meta({ isPlaying: false, positionSec: 10 }), 1_009_000)).toBe(10);
  });
  it('never runs backwards if the local clock is behind the arrival time', () => {
    expect(roomPositionSec(meta({ positionSec: 5 }), 999_000)).toBe(5);
  });
});

describe('canSyncToRoom (the drift corrector)', () => {
  it('allows a nudge only for the settled, playing track the room is on', () => {
    expect(canSyncToRoom('a', 'a', 'playing')).toBe(true);
  });
  it('refuses while a newer track is still loading and the audible one is the skipped song', () => {
    expect(canSyncToRoom('old', 'new', 'loading')).toBe(false);
    expect(canSyncToRoom('old', 'new', 'playing')).toBe(false);
  });
  it('refuses while the right track is not playing (loading, paused, ended) or nothing is loaded', () => {
    expect(canSyncToRoom('a', 'a', 'loading')).toBe(false);
    expect(canSyncToRoom('a', 'a', 'paused')).toBe(false);
    expect(canSyncToRoom(null, 'a', 'playing')).toBe(false);
    expect(canSyncToRoom('a', null, 'playing')).toBe(false);
  });
});

describe('isLoadStillCurrent (a load\'s completion handler)', () => {
  it('is true only when the engine and the room are both on the track that just loaded', () => {
    expect(isLoadStillCurrent('a', 'a', 'a')).toBe(true);
    expect(isLoadStillCurrent('a', 'old', 'b')).toBe(false); // overtaken: audible track is the old one, room is on b
    expect(isLoadStillCurrent('a', 'a', 'b')).toBe(false); // loaded, but the room has already moved on
    expect(isLoadStillCurrent('a', null, 'a')).toBe(false);
  });
});

describe('catchUpTarget', () => {
  it('seeks a device that joined mid-song to the room position', () => {
    expect(catchUpTarget(meta({ positionSec: 95 }), 1_002_000, 0, 1.5, 200)).toBeCloseTo(97);
  });
  it('does nothing when the drift is within tolerance — a needless seek is audible, the drift is not', () => {
    expect(catchUpTarget(meta({ positionSec: 3 }), 1_000_000, 2.2, 1.5, 200)).toBeNull();
    expect(catchUpTarget(meta({ positionSec: 0 }), 1_000_400, 0.1, 1.5, 200)).toBeNull();
  });
  it('corrects a device that is behind once the drift passes the tolerance', () => {
    expect(catchUpTarget(meta({ positionSec: 3 }), 1_003_000, 0.5, 1.5, 200)).toBeCloseTo(6);
  });
  it('never targets the very end of the track (that would end it and advance the whole room)', () => {
    expect(catchUpTarget(meta({ positionSec: 199.5 }), 1_000_000, 10, 1.5, 200)).toBeNull();
    expect(catchUpTarget(meta({ positionSec: 500 }), 1_000_000, 10, 1.5, 200)).toBeNull();
  });
  it('still seeks when the track length is unknown (0)', () => {
    expect(catchUpTarget(meta({ positionSec: 40 }), 1_000_000, 0, 1.5, 0)).toBe(40);
  });
});
