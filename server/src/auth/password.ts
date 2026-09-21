import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

/**
 * scrypt from Node's own crypto: no native dependency to build into the image (CLAUDE.md rule 6), and the cost is set
 * to ~16MB / ~50-100ms on this VM — enough to make guessing slow, cheap enough for the occasional sign-in.
 * Stored as `scrypt$N$r$p$salt$hash` so the parameters can be raised later without invalidating old hashes.
 */
const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 32;
const MAX_MEM = 64 * 1024 * 1024;

// A sign-in burst (a script hammering the endpoint) must not put a dozen 16MB hashes in memory at once on a 1GB VM:
// hashes run two at a time, the rest wait.
const MAX_CONCURRENT = 2;
let active = 0;
const waiting: Array<() => void> = [];

async function withSlot<T>(work: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
  active += 1;
  try {
    return await work();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}

function derive(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, KEY_LEN, { N: n, r, p, maxmem: MAX_MEM }, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

export function hashPassword(password: string): Promise<string> {
  return withSlot(async () => {
    const salt = randomBytes(16);
    const key = await derive(password, salt, N, R, P);
    return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
  });
}

export function verifyPassword(password: string, stored: string): Promise<boolean> {
  return withSlot(async () => {
    const [scheme, n, r, p, salt, hash] = stored.split('$');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const expected = Buffer.from(hash, 'base64');
    const actual = await derive(password, Buffer.from(salt, 'base64'), Number(n), Number(r), Number(p));
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}

// Verified against when the username does not exist, so a wrong username and a wrong password take the same time and
// the sign-in form cannot be used to find out which usernames exist.
let dummyHash: Promise<string> | null = null;
export function verifyAgainstDummy(password: string): Promise<boolean> {
  dummyHash ??= hashPassword(randomBytes(12).toString('hex'));
  return dummyHash.then((hash) => verifyPassword(password, hash)).then(() => false);
}

const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no look-alikes (0/O, 1/l/I)
/** A readable temporary password for the admin to hand over; the user must replace it at first sign-in. */
export function generatePassword(length = 12): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('');
}

export const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;
