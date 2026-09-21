/**
 * Brute-force protection for sign-in, in memory (a restart clears it — the audit log still has the history).
 * Three counters, because each alone has a hole:
 *  - per (IP, username): 5 wrong passwords lock that pair for 15 minutes — the rule the owner asked for, and it does
 *    not let a stranger lock the real owner out from the owner's own IP;
 *  - per IP: 20 failures across any usernames lock the IP — stops one machine walking a username list;
 *  - per username: 30 failures from anywhere lock that username — stops a botnet spreading guesses over many IPs.
 * Bounded (CLAUDE.md rule 1): a hard cap on keys plus a sweep, since the keys come from input we do not control.
 */
export interface LimiterOptions {
  maxPairFailures?: number;
  maxIpFailures?: number;
  maxUserFailures?: number;
  lockMs?: number;
  windowMs?: number;
  maxKeys?: number;
  now?: () => number;
}

interface Counter {
  count: number;
  firstAt: number;
  lockedUntil: number;
}

export type LimitCheck = { locked: false } | { locked: true; retryAfterSec: number };

export class LoginLimiter {
  private readonly counters = new Map<string, Counter>();
  private readonly maxPair: number;
  private readonly maxIp: number;
  private readonly maxUser: number;
  private readonly lockMs: number;
  private readonly windowMs: number;
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(options: LimiterOptions = {}) {
    this.maxPair = options.maxPairFailures ?? 5;
    this.maxIp = options.maxIpFailures ?? 20;
    this.maxUser = options.maxUserFailures ?? 30;
    this.lockMs = options.lockMs ?? 15 * 60_000;
    this.windowMs = options.windowMs ?? 15 * 60_000;
    this.maxKeys = options.maxKeys ?? 5000;
    this.now = options.now ?? Date.now;
  }

  private keys(ip: string, username: string): Array<[string, number]> {
    return [
      [`pair:${ip}|${username}`, this.maxPair],
      [`ip:${ip}`, this.maxIp],
      [`user:${username}`, this.maxUser],
    ];
  }

  check(ip: string, username: string): LimitCheck {
    const now = this.now();
    let until = 0;
    for (const [key] of this.keys(ip, username)) until = Math.max(until, this.counters.get(key)?.lockedUntil ?? 0);
    return until > now ? { locked: true, retryAfterSec: Math.ceil((until - now) / 1000) } : { locked: false };
  }

  fail(ip: string, username: string): void {
    const now = this.now();
    for (const [key, max] of this.keys(ip, username)) {
      let counter = this.counters.get(key);
      if (!counter || (counter.lockedUntil <= now && now - counter.firstAt > this.windowMs)) counter = { count: 0, firstAt: now, lockedUntil: 0 };
      counter.count += 1;
      if (counter.count >= max) counter.lockedUntil = now + this.lockMs;
      this.counters.delete(key); // re-insert so eviction order stays oldest-touched first
      this.counters.set(key, counter);
    }
    while (this.counters.size > this.maxKeys) {
      const oldest = this.counters.keys().next().value;
      if (oldest === undefined) break;
      this.counters.delete(oldest);
    }
  }

  /** A correct password clears this pair's streak (not the IP/username totals, which are about volume). */
  reset(ip: string, username: string): void {
    this.counters.delete(`pair:${ip}|${username}`);
  }

  sweep(): void {
    const now = this.now();
    for (const [key, counter] of this.counters) {
      if (counter.lockedUntil <= now && now - counter.firstAt > this.windowMs) this.counters.delete(key);
    }
  }

  /** Locked usernames / IPs right now, for the admin dashboard. */
  lockedNow(): Array<{ key: string; retryAfterSec: number }> {
    const now = this.now();
    const out: Array<{ key: string; retryAfterSec: number }> = [];
    for (const [key, counter] of this.counters) {
      if (counter.lockedUntil > now) out.push({ key, retryAfterSec: Math.ceil((counter.lockedUntil - now) / 1000) });
    }
    return out;
  }

  unlock(key: string): void {
    this.counters.delete(key);
  }
}

export const loginLimiter = new LoginLimiter();
setInterval(() => loginLimiter.sweep(), 5 * 60_000).unref();
