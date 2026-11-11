import { Router } from 'express';
import { rateLimited } from '../auth/rateLimit';
import { recordListening } from '../metrics/usage';

/**
 * A device's own count of what it played (src/stats/listeningStats.ts): seconds heard and tracks started/finished/
 * skipped, per hour and kind. Needed because a song kept on the phone plays without the server ever seeing a byte of
 * it, so bytes alone would say a heavy listener barely uses the app. Counts only, never which song.
 */
export const usageRouter = Router();

const MAX_BUCKETS = 400;
// A device holds its counts while offline (up to two weeks of them) and sends them once back online.
const MAX_AGE_MS = 14 * 86_400_000;

const count = (value: unknown, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(Math.round(value), 0), max) : 0;

usageRouter.post('/usage/listen', (req, res) => {
  const accountId = req.session?.accountId;
  // An admin account never plays; a phone that keeps failing to send must not be able to flood the counts either.
  if (!accountId || req.session?.role === 'admin' || rateLimited(`listen:${accountId}`, 30, 10 * 60 * 1000)) {
    res.status(204).end();
    return;
  }
  const buckets: unknown = req.body?.buckets;
  if (!Array.isArray(buckets)) {
    res.status(400).json({ error: 'Invalid report.' });
    return;
  }
  const now = Date.now();
  for (const raw of buckets.slice(0, MAX_BUCKETS)) {
    if (!raw || typeof raw !== 'object') continue;
    const bucket = raw as Record<string, unknown>;
    const hour = typeof bucket.hour === 'number' && Number.isFinite(bucket.hour) ? bucket.hour : NaN;
    const kind = bucket.kind === 'podcast' ? 'podcast' : bucket.kind === 'song' ? 'song' : null;
    // Not from the future (a phone's clock a little ahead is fine), not older than a device keeps.
    if (!kind || !(hour <= now + 3_600_000 && hour >= now - MAX_AGE_MS)) continue;
    recordListening(accountId, {
      hour,
      kind,
      // An hour holds at most 3600 seconds of listening, whatever a confused device says.
      listenSec: count(bucket.listenSec, 3600),
      started: count(bucket.started, 500),
      completed: count(bucket.completed, 500),
      skipped: count(bucket.skipped, 500),
    });
  }
  res.status(204).end();
});
