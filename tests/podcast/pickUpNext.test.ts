import { describe, expect, it } from 'vitest';
import { pickUpNext } from '../../src/podcast/playEpisode';
import type { Episode } from '../../src/podcast/types';

const ep = (id: string, channelId: string | null = 'horor', durationSec = 1800): Episode => ({
  id,
  title: id,
  thumbnail: '',
  durationSec,
  channelId,
  channelName: channelId,
});

const none = () => false;

describe('pickUpNext', () => {
  it("continues the same show's list first: part 2 after part 1", () => {
    const list = [ep('p1'), ep('p2'), ep('p3')];
    const next = pickUpNext({
      current: { id: 'p1', channelId: 'horor' },
      related: [ep('other', 'bisnis')],
      context: { episodes: list },
      finished: none,
      recent: [],
    });
    expect(next?.id).toBe('p2');
  });

  it("follows YouTube's up next when the list is not this show", () => {
    const list = [ep('a', 'horor'), ep('b', 'komedi')];
    const next = pickUpNext({
      current: { id: 'a', channelId: 'horor' },
      related: [ep('r1', 'horor2'), ep('r2')],
      context: { episodes: list },
      finished: none,
      recent: [],
    });
    expect(next?.id).toBe('r1');
  });

  it('skips heard, recently continued, the current one and short clips', () => {
    const related = [ep('current'), ep('heard'), ep('again'), ep('clip', 'horor', 90), ep('good')];
    const next = pickUpNext({
      current: { id: 'current', channelId: 'horor' },
      related,
      context: null,
      finished: (id) => id === 'heard',
      recent: ['again'],
    });
    expect(next?.id).toBe('good');
  });

  it('keeps an episode of unknown length (the RSS feed gives none)', () => {
    const next = pickUpNext({ current: { id: 'x', channelId: null }, related: [ep('feed', 'horor', 0)], context: null, finished: none, recent: [] });
    expect(next?.id).toBe('feed');
  });

  it('falls back to the next one in the list, whatever the show, then to nothing', () => {
    const list = [ep('a', 'horor'), ep('b', 'komedi')];
    expect(pickUpNext({ current: { id: 'a', channelId: 'horor' }, related: [], context: { episodes: list }, finished: none, recent: [] })?.id).toBe('b');
    expect(pickUpNext({ current: { id: 'b', channelId: 'komedi' }, related: [], context: { episodes: list }, finished: none, recent: [] })).toBeNull();
  });
});
