import { randomBytes } from 'node:crypto';

/**
 * "Linked devices" the way WhatsApp Web does it: the NEW device (a laptop) asks for a code and
 * shows it as a QR; the device that already holds the data (the phone) scans it inside the app
 * and approves. In-memory with a TTL sweep for the same reasons as pairingManager.ts — a
 * request only has to outlive two minutes, not a restart.
 */
interface LinkRequest {
  deviceId: string;
  deviceName: string;
  deviceKind: string;
  approved: boolean;
  expiresAt: number;
}

const requests = new Map<string, LinkRequest>();

// 8 hex chars (~4 billion). Longer than a Jam code because approving a request hands the
// requesting device the approver's whole library, and the code is all that identifies it.
const CODE_BYTES = 4;
export const LINK_REQUEST_TTL_SEC = 120;
const MAX_PENDING_REQUESTS = 500;

function generateCode(): string {
  let code: string;
  do {
    code = randomBytes(CODE_BYTES).toString('hex').toUpperCase();
  } while (requests.has(code));
  return code;
}

export function createLinkRequest(deviceId: string, deviceName: string, deviceKind: string): string | null {
  // One live request per device: asking again replaces the old code instead of piling up.
  for (const [code, request] of requests) {
    if (request.deviceId === deviceId) requests.delete(code);
  }
  if (requests.size >= MAX_PENDING_REQUESTS) return null; // hard cap — the key space is attacker-influenced
  const code = generateCode();
  requests.set(code, { deviceId, deviceName, deviceKind, approved: false, expiresAt: Date.now() + LINK_REQUEST_TTL_SEC * 1000 });
  return code;
}

function live(code: string): LinkRequest | undefined {
  const request = requests.get(code.toUpperCase());
  if (!request) return undefined;
  if (request.expiresAt < Date.now()) {
    requests.delete(code.toUpperCase());
    return undefined;
  }
  return request;
}

export function getLinkRequest(code: string): Readonly<LinkRequest> | undefined {
  return live(code);
}

export function markLinkApproved(code: string): void {
  const request = live(code);
  if (request) {
    request.approved = true;
    // Kept briefly so the waiting device's next poll can see it, then swept.
    request.expiresAt = Math.max(request.expiresAt, Date.now() + 30_000);
  }
}

setInterval(() => {
  const now = Date.now();
  for (const [code, request] of requests) {
    if (request.expiresAt < now) requests.delete(code);
  }
}, 60_000).unref();

// --- tiny fixed-window rate limiter for the endpoints that take a guessable code -------------
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
