// Imports backend code (server/src) that the frontend Docker build context does not contain —
// see the note in tests/server/priorityLimiter.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoundedTtlCache } from '../../server/src/youtube/boundedCache';

describe('BoundedTtlCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('never holds more than its cap, dropping the oldest entry first', () => {
    const cache = new BoundedTtlCache<number>(3, 60_000);
    for (const key of ['a', 'b', 'c', 'd']) cache.set(key, key.charCodeAt(0));
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('d')).toBe(100);
  });

  it('expires entries after the TTL', () => {
    const cache = new BoundedTtlCache<string>(10, 1_000);
    cache.set('k', 'v');
    expect(cache.get('k')).toBe('v');
    vi.advanceTimersByTime(1_001);
    expect(cache.get('k')).toBeUndefined();
  });

  it('shares one load between concurrent callers and caches the result', async () => {
    const cache = new BoundedTtlCache<string>(10, 60_000);
    const load = vi.fn(async () => 'value');
    const [a, b] = await Promise.all([cache.getOrLoad('k', load), cache.getOrLoad('k', load)]);
    expect([a, b]).toEqual(['value', 'value']);
    await cache.getOrLoad('k', load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed load, so the next call retries', async () => {
    const cache = new BoundedTtlCache<string>(10, 60_000);
    await expect(cache.getOrLoad('k', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(cache.getOrLoad('k', async () => 'ok')).resolves.toBe('ok');
  });
});
