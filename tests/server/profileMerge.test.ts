// Imports backend code (server/src) — see the note in tests/server/priorityLimiter.test.ts.
import { describe, expect, it } from 'vitest';
import { MAX_HISTORY, mergeProfile, sanitizeProfile, type Profile } from '../../server/src/library/profileMerge';

const event = (songId: string, timestamp: number) => ({ songId, artistIds: ['a'], timestamp, completed: true });
const profile = (over: Partial<Profile> = {}): Profile => ({ history: [], clearedAt: 0, weekly: null, daily: null, ...over });
const mix = <K extends string>(key: K, value: string) => ({ [key]: value, songs: [{ id: `${value}-1`, name: 'x' }] }) as never;

describe('mergeProfile', () => {
  it('unions history from two devices without duplicates, oldest first', () => {
    const a = profile({ history: [event('s1', 1), event('s2', 2)] });
    const b = profile({ history: [event('s2', 2), event('s3', 3)] });
    expect(mergeProfile(a, b).history.map((e) => e.songId)).toEqual(['s1', 's2', 's3']);
  });

  it('is commutative: either device sending first ends in the same history', () => {
    const a = profile({ history: [event('s1', 1), event('s2', 5)] });
    const b = profile({ history: [event('s3', 3)] });
    expect(mergeProfile(a, b).history).toEqual(mergeProfile(b, a).history);
  });

  it('keeps only the newest MAX_HISTORY events', () => {
    const many = profile({ history: Array.from({ length: MAX_HISTORY + 50 }, (_, i) => event(`s${i}`, i + 1)) });
    const merged = mergeProfile(profile(), many);
    expect(merged.history).toHaveLength(MAX_HISTORY);
    expect(merged.history[0].timestamp).toBe(51);
  });

  it('a cleared history stays cleared: older events from another device do not come back', () => {
    const cleared = profile({ clearedAt: 100 });
    const stale = profile({ history: [event('old', 50), event('new', 150)] });
    expect(mergeProfile(cleared, stale).history.map((e) => e.songId)).toEqual(['new']);
    expect(mergeProfile(stale, cleared).clearedAt).toBe(100);
  });

  it('the newer week/day wins; on a tie the first publisher wins', () => {
    const stored = profile({ weekly: mix('weekKey', '2026-W38'), daily: mix('dayKey', '2026-09-20') });
    const newer = profile({ weekly: mix('weekKey', '2026-W39'), daily: mix('dayKey', '2026-09-21') });
    expect(mergeProfile(stored, newer).weekly?.weekKey).toBe('2026-W39');
    expect(mergeProfile(newer, stored).daily?.dayKey).toBe('2026-09-21');
    const tie = profile({ daily: { dayKey: '2026-09-20', songs: [{ id: 'other', name: 'y' }] } });
    expect(mergeProfile(stored, tie).daily?.songs[0].id).toBe('2026-09-20-1');
  });
});

describe('sanitizeProfile', () => {
  it('drops malformed events and mixes instead of storing them', () => {
    const clean = sanitizeProfile({
      history: [event('ok', 1), { songId: 5 }, null, { ...event('bad', 2), artistIds: [1] }],
      clearedAt: -3,
      weekly: { weekKey: 'not-a-week', songs: [{ id: 'x', name: 'y' }] },
      daily: { dayKey: '2026-09-21', songs: [{ id: 'x', name: 'y' }, 'junk'] },
    });
    expect(clean.history.map((e) => e.songId)).toEqual(['ok']);
    expect(clean.clearedAt).toBe(0);
    expect(clean.weekly).toBeNull();
    expect(clean.daily?.songs).toHaveLength(1);
  });

  it('survives garbage', () => {
    expect(sanitizeProfile(null)).toEqual({ history: [], clearedAt: 0, weekly: null, daily: null });
    expect(sanitizeProfile('nope').history).toEqual([]);
  });
});
