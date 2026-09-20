/**
 * TTL cache with a hard entry cap AND a periodic sweep (never just lazy TTL checks — see
 * CLAUDE.md rule #1: on a 1GB VM a cache keyed by unbounded input must have a ceiling), plus
 * in-flight de-duplication so a burst of requests for the same key shares one upstream call.
 */
interface Entry<V> {
  value: V;
  expiresAt: number;
}

const allCaches = new Set<BoundedTtlCache<unknown>>();

setInterval(() => {
  for (const cache of allCaches) cache.sweep();
}, 5 * 60 * 1000).unref();

export class BoundedTtlCache<V> {
  private readonly entries = new Map<string, Entry<V>>();
  private readonly inFlight = new Map<string, Promise<V>>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(maxEntries: number, ttlMs: number) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    allCaches.add(this as BoundedTtlCache<unknown>);
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key); // re-insert so this key becomes the most-recently-set for eviction order
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  /** Cached value, or the result of `load()` — which is shared by every concurrent caller for this key. */
  async getOrLoad(key: string, load: () => Promise<V>): Promise<V> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const loading = load()
      .then((value) => {
        this.set(key, value);
        return value;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, loading);
    return loading;
  }

  sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}
