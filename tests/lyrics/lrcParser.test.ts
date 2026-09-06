import { describe, expect, it } from 'vitest';
import { parseLrc } from '../../src/lyrics/lrcParser';

describe('parseLrc', () => {
  it('parses standard LRC lines in order', () => {
    const raw = '[00:01.00]Hello\n[00:05.50]World';
    expect(parseLrc(raw)).toEqual([
      { time: 1, text: 'Hello' },
      { time: 5.5, text: 'World' },
    ]);
  });

  it('handles multiple timestamp tags on one line (repeated chorus)', () => {
    const raw = '[00:10.00][00:20.00]Chorus line';
    expect(parseLrc(raw)).toEqual([
      { time: 10, text: 'Chorus line' },
      { time: 20, text: 'Chorus line' },
    ]);
  });

  it('ignores metadata tags like [ar:] and [ti:]', () => {
    const raw = '[ar:Some Artist]\n[ti:Some Title]\n[00:02.00]Actual lyric';
    expect(parseLrc(raw)).toEqual([{ time: 2, text: 'Actual lyric' }]);
  });

  it('sorts lines by time even if the input is out of order', () => {
    const raw = '[00:05.00]Second\n[00:01.00]First';
    expect(parseLrc(raw).map((line) => line.text)).toEqual(['First', 'Second']);
  });
});
