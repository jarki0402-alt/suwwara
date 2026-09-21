import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Song } from '../../src/api/types';

const getLyricsPayload = vi.fn();
vi.mock('../../src/api/endpoints/lyrics', () => ({ getLyricsPayload: (id: string) => getLyricsPayload(id) }));

const song = (id: string, duration = 200): Song => ({ id, duration }) as Song;

describe('resolveLyrics', () => {
  beforeEach(() => {
    getLyricsPayload.mockReset();
    vi.resetModules();
  });

  it('does not remember a failed lookup: the next call asks again instead of answering "none"', async () => {
    const { resolveLyrics } = await import('../../src/lyrics/lyricsResolver');
    getLyricsPayload.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ type: 'plain', source: 'lrclib', text: 'la la', matchedDurationSec: 200 });

    await expect(resolveLyrics(song('aaaaaaaaaaa'))).rejects.toThrow('network');
    await expect(resolveLyrics(song('aaaaaaaaaaa'))).resolves.toEqual({ type: 'plain', text: 'la la', source: 'lrclib' });
    expect(getLyricsPayload).toHaveBeenCalledTimes(2);
  });

  it('parses synced lyrics into timed lines', async () => {
    const { resolveLyrics } = await import('../../src/lyrics/lyricsResolver');
    getLyricsPayload.mockResolvedValueOnce({ type: 'synced', source: 'lrclib', lrc: '[00:01.00]a\n[00:05.00]b', matchedDurationSec: 201.5 });

    const result = await resolveLyrics(song('bbbbbbbbbbb'));
    expect(result.type).toBe('synced');
    expect(result.type === 'synced' && result.lines.map((line) => line.text)).toEqual(['a', 'b']);
  });

  it('answers a repeat request from memory and shares one request between concurrent callers', async () => {
    const { resolveLyrics } = await import('../../src/lyrics/lyricsResolver');
    getLyricsPayload.mockResolvedValue({ type: 'instrumental' });

    await Promise.all([resolveLyrics(song('ccccccccccc')), resolveLyrics(song('ccccccccccc'))]);
    await resolveLyrics(song('ccccccccccc'));
    expect(getLyricsPayload).toHaveBeenCalledTimes(1);
  });

  it('treats an unparseable synced body as no lyrics rather than an empty panel', async () => {
    const { resolveLyrics } = await import('../../src/lyrics/lyricsResolver');
    getLyricsPayload.mockResolvedValueOnce({ type: 'synced', source: 'lrclib', lrc: 'not lrc at all', matchedDurationSec: 200 });
    await expect(resolveLyrics(song('ddddddddddd'))).resolves.toEqual({ type: 'none' });
  });
});
