import { randomBytes } from 'node:crypto';

// Mirrors the room-code pattern in jam/roomManager.ts (6 hex chars, verified
// unique, in-memory with a TTL sweep) — pairing codes are just as short-lived
// and don't need to survive a restart, so there's no reason to put them in
// Postgres alongside the durable account/device rows.
interface PendingCode {
  accountId: string;
  expiresAt: number;
}

const codes = new Map<string, PendingCode>();

const CODE_BYTES = 3; // 6 hex chars — plenty unguessable for a closed circle, matches roomManager's ROOM_CODE_BYTES
const CODE_TTL_MS = 5 * 60 * 1000;
const GC_INTERVAL_MS = 60 * 1000;

function generateCode(): string {
  let code: string;
  do {
    code = randomBytes(CODE_BYTES).toString('hex').toUpperCase();
  } while (codes.has(code));
  return code;
}

/** Called by the already-onboarded device that wants to link a second device to its account. */
export function createPairingCode(accountId: string): string {
  const code = generateCode();
  codes.set(code, { accountId, expiresAt: Date.now() + CODE_TTL_MS });
  return code;
}

export type ConsumeResult = { ok: true; accountId: string } | { ok: false; reason: 'not-found' | 'expired' };

/** Called by the new device once it has the code (scanned QR or typed manually). One-shot — the code is deleted whether or not the caller proceeds, so it can't be replayed. */
export function consumePairingCode(code: string): ConsumeResult {
  const pending = codes.get(code.toUpperCase());
  codes.delete(code.toUpperCase());
  if (!pending) return { ok: false, reason: 'not-found' };
  if (pending.expiresAt < Date.now()) return { ok: false, reason: 'expired' };
  return { ok: true, accountId: pending.accountId };
}

setInterval(() => {
  const now = Date.now();
  for (const [code, pending] of codes) {
    if (pending.expiresAt < now) codes.delete(code);
  }
}, GC_INTERVAL_MS).unref();
