import { generateId } from '../utils/idGen';

const STORAGE_KEY = 'suwwara-device-id';

/**
 * This device's passwordless identity: a random id minted once and reused
 * forever, sent as `Authorization: Bearer <deviceId>` on every request that
 * touches account-scoped data (library, pairing — see src/api/authClient.ts).
 * No password, no email — pairing a second device to the same account (see
 * DevicePairingSheet) is what makes this feel like "one account" rather than
 * "one login per device".
 *
 * Deliberately a plain localStorage read/write (not a Zustand `persist`
 * store) — same convention as src/recommendation/historyLog.ts: wrapped in
 * try/catch since private browsing / storage quota can throw on write, and a
 * fresh id is minted (not persisted) if storage is unavailable rather than
 * failing outright — the user just won't get pairing continuity across a
 * reload in that one edge case.
 */
export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const id = generateId();
    localStorage.setItem(STORAGE_KEY, id);
    return id;
  } catch {
    return generateId();
  }
}
