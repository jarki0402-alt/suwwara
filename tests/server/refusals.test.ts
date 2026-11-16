import { afterEach, describe, expect, it } from 'vitest';
import { clearRefusals, parseRefusal, playability, refusalFor, refusalResponse, rememberRefusal, ResolveRefusedError } from '../../server/src/youtube/refusals';

afterEach(() => clearRefusals());

describe('refusals', () => {
  it('reads the reason from ytdlp-service and ignores anything else', () => {
    expect(parseRefusal('{"detail":{"reason":"account","message":"Sign in to confirm your age"}}')).toEqual({
      reason: 'account',
      message: 'Sign in to confirm your age',
    });
    expect(parseRefusal('{"detail":"ERROR: something broke"}')).toBeNull();
    expect(parseRefusal('<html>502</html>')).toBeNull();
    expect(parseRefusal('{"detail":{"reason":"weird"}}')).toBeNull();
  });

  it('remembers each kind for its own time', () => {
    const now = 1_000_000;
    rememberRefusal('gone1', 'gone', now);
    rememberRefusal('age1', 'account', now);
    rememberRefusal('bot1', 'limited', now);
    expect(refusalFor('bot1', now + 60_000)).toBe('limited');
    expect(refusalFor('bot1', now + 3 * 60_000)).toBeNull();
    expect(refusalFor('age1', now + 30 * 60_000)).toBe('account');
    expect(refusalFor('age1', now + 2 * 60 * 60_000)).toBeNull();
    expect(refusalFor('gone1', now + 23 * 60 * 60_000)).toBe('gone');
  });

  it('tells the player to skip for good or to wait', () => {
    rememberRefusal('gone1', 'gone');
    rememberRefusal('age1', 'account');
    rememberRefusal('bot1', 'limited');
    expect(playability('gone1')).toBe('unplayable');
    expect(playability('age1')).toBe('unplayable');
    expect(playability('bot1')).toBe('limited');
    expect(playability('fine')).toBe('ok');
  });

  it('answers 410 for unplayable, 503 with Retry-After for limited, nothing for other errors', () => {
    expect(refusalResponse(new ResolveRefusedError('gone', 'x'))?.status).toBe(410);
    expect(refusalResponse(new ResolveRefusedError('account', 'x'))?.status).toBe(410);
    const limited = refusalResponse(new ResolveRefusedError('limited', 'x'));
    expect(limited?.status).toBe(503);
    expect(limited?.retryAfterSec).toBe(120);
    expect(refusalResponse(new Error('timeout'))).toBeNull();
  });

  it('stays bounded however many videos are refused', () => {
    for (let index = 0; index < 700; index += 1) rememberRefusal(`v${index}`, 'gone');
    expect(refusalFor('v0')).toBeNull();
    expect(refusalFor('v699')).toBe('gone');
  });
});
