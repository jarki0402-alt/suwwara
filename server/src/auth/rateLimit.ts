/** Tiny fixed-window rate limiter (Connect state/command spam per device), bounded and swept — see CLAUDE.md rule 1. */
const attempts = new Map<string, { count: number; resetAt: number }>();

export function rateLimited(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    if (attempts.size > 5000) attempts.delete(attempts.keys().next().value as string);
    return false;
  }
  entry.count += 1;
  return entry.count > max;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) {
    if (entry.resetAt < now) attempts.delete(key);
  }
}, 5 * 60_000).unref();
