import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/audio-engine/AudioEngine', () => ({ audioEngine: { getCurrentSong: () => null, seek: () => {} } }));

const { clearResumePoint, consumeHold, holdNextLoad, peekResumePoint, setResumePoint, takeResumePoint } = await import('../../src/connect/sessionHold');

describe('sessionHold', () => {
  it('holds exactly the named song, once', () => {
    holdNextLoad('a');
    expect(consumeHold('b')).toBe(false);
    expect(consumeHold('a')).toBe(true);
    expect(consumeHold('a')).toBe(false);
  });

  it('hands a resume point only to its own song, and only once', () => {
    setResumePoint('a', 93);
    expect(peekResumePoint('b')).toBeNull();
    expect(takeResumePoint('b')).toBeNull();
    expect(peekResumePoint('a')).toBe(93);
    expect(takeResumePoint('a')).toBe(93);
    expect(takeResumePoint('a')).toBeNull();
  });

  it('forgets a resume point once something else is chosen', () => {
    setResumePoint('a', 10);
    clearResumePoint();
    expect(takeResumePoint('a')).toBeNull();
  });
});
