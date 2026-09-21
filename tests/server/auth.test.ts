// Imports backend code (server/src) — see the note in tests/server/priorityLimiter.test.ts.
import { describe, expect, it } from 'vitest';
import { LoginLimiter } from '../../server/src/auth/loginLimiter';
import { generatePassword, hashPassword, USERNAME_PATTERN, verifyAgainstDummy, verifyPassword } from '../../server/src/auth/password';
import { parseCookie } from '../../server/src/auth/cookie';

describe('password hashing', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse', hash)).toBe(true);
    expect(await verifyPassword('wrong horse', hash)).toBe(false);
  });

  it('salts: the same password hashes differently each time', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('rejects a malformed stored hash instead of throwing', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyAgainstDummy('anything')).toBe(false);
  });

  it('generates readable temporary passwords', () => {
    const password = generatePassword();
    expect(password).toHaveLength(12);
    expect(password).not.toMatch(/[0OlI1]/);
  });

  it('accepts only sane usernames', () => {
    expect(USERNAME_PATTERN.test('fajar.rizky')).toBe(true);
    expect(USERNAME_PATTERN.test('ab')).toBe(false);
    expect(USERNAME_PATTERN.test('has space')).toBe(false);
  });
});

describe('LoginLimiter', () => {
  const make = () => {
    let now = 1_000_000;
    const limiter = new LoginLimiter({ now: () => now });
    return { limiter, advance: (ms: number) => (now += ms) };
  };

  it('locks a (ip, username) pair for 15 minutes after 5 failures', () => {
    const { limiter, advance } = make();
    for (let i = 0; i < 4; i += 1) limiter.fail('1.1.1.1', 'fajar');
    expect(limiter.check('1.1.1.1', 'fajar').locked).toBe(false);
    limiter.fail('1.1.1.1', 'fajar');
    const locked = limiter.check('1.1.1.1', 'fajar');
    expect(locked).toEqual({ locked: true, retryAfterSec: 900 });
    advance(15 * 60_000 + 1);
    expect(limiter.check('1.1.1.1', 'fajar').locked).toBe(false);
  });

  it('does not lock the owner out from their own IP because a stranger failed elsewhere', () => {
    const { limiter } = make();
    for (let i = 0; i < 5; i += 1) limiter.fail('9.9.9.9', 'fajar');
    expect(limiter.check('9.9.9.9', 'fajar').locked).toBe(true);
    expect(limiter.check('1.1.1.1', 'fajar').locked).toBe(false);
  });

  it('locks an IP that walks many usernames', () => {
    const { limiter } = make();
    for (let i = 0; i < 20; i += 1) limiter.fail('2.2.2.2', `user${i}`);
    expect(limiter.check('2.2.2.2', 'someone-new').locked).toBe(true);
  });

  it('locks a username guessed from many IPs', () => {
    const { limiter } = make();
    for (let i = 0; i < 30; i += 1) limiter.fail(`10.0.0.${i}`, 'fajar');
    expect(limiter.check('10.0.1.1', 'fajar').locked).toBe(true);
  });

  it('a correct password clears the pair streak', () => {
    const { limiter } = make();
    for (let i = 0; i < 4; i += 1) limiter.fail('1.1.1.1', 'fajar');
    limiter.reset('1.1.1.1', 'fajar');
    limiter.fail('1.1.1.1', 'fajar');
    expect(limiter.check('1.1.1.1', 'fajar').locked).toBe(false);
  });

  it('stays bounded under a flood of distinct keys', () => {
    const limiter = new LoginLimiter({ maxKeys: 50 });
    for (let i = 0; i < 500; i += 1) limiter.fail(`ip${i}`, `u${i}`);
    expect(limiter.lockedNow().length).toBeLessThanOrEqual(50);
  });
});

describe('parseCookie', () => {
  it('finds a cookie among several', () => {
    expect(parseCookie('a=1; suwwara_session=tok%2Ben; b=2', 'suwwara_session')).toBe('tok+en');
    expect(parseCookie('a=1', 'suwwara_session')).toBeNull();
    expect(parseCookie(undefined, 'x')).toBeNull();
  });
});

import { MIN_PASSWORD_LENGTH, passwordProblem, SESSION_DAYS } from '../../server/src/auth/policy';

describe('policy: admin accounts are held to stricter rules', () => {
  it('admin sessions are short, ordinary ones long', () => {
    expect(SESSION_DAYS.admin).toBe(7);
    expect(SESSION_DAYS.user).toBe(90);
  });

  it('an admin password needs 12 characters, an ordinary one 8', () => {
    expect(MIN_PASSWORD_LENGTH).toEqual({ admin: 12, user: 8 });
    expect(passwordProblem('12345678', 'user')).toBeNull();
    expect(passwordProblem('12345678', 'admin')).toMatch(/minimal 12/);
    expect(passwordProblem('a-long-enough-one', 'admin')).toBeNull();
    expect(passwordProblem('x'.repeat(129), 'user')).toMatch(/maksimal 128/);
    expect(passwordProblem(undefined, 'user')).toMatch(/minimal 8/);
  });
});
