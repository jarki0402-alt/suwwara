/**
 * How the last audio resolves (yt-dlp) went, for the admin dashboard: a small ring buffer, not a log. Aborted resolves
 * (the listener moved on) are not recorded — they are not failures, and they would drag the averages down.
 */
const MAX_SAMPLES = 200;
const samples: Array<{ at: number; ms: number; ok: boolean }> = [];

export function recordResolve(ms: number, ok: boolean): void {
  samples.push({ at: Date.now(), ms, ok });
  if (samples.length > MAX_SAMPLES) samples.shift();
}

export interface ResolveSummary {
  count: number;
  failures: number;
  avgMs: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}

export function resolveSummary(windowMs = 60 * 60 * 1000): ResolveSummary {
  const cutoff = Date.now() - windowMs;
  const recent = samples.filter((sample) => sample.at >= cutoff);
  const times = recent.filter((sample) => sample.ok).map((sample) => sample.ms).sort((a, b) => a - b);
  return {
    count: recent.length,
    failures: recent.filter((sample) => !sample.ok).length,
    avgMs: times.length ? Math.round(times.reduce((sum, ms) => sum + ms, 0) / times.length) : null,
    p95Ms: times.length ? times[Math.min(times.length - 1, Math.floor(times.length * 0.95))] : null,
    maxMs: times.length ? times[times.length - 1] : null,
  };
}
