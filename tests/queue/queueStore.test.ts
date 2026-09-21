import { beforeEach, describe, expect, it } from 'vitest';
import type { Song } from '../../src/api/types';
import { useQueueStore } from '../../src/stores/queueStore';

const song = (id: string) => ({ id, name: id }) as Song;
const playOrder = () => {
  const { queue, order } = useQueueStore.getState();
  return order.map((index) => queue[index].id);
};

describe('queueStore.playNext', () => {
  beforeEach(() => {
    useQueueStore.setState({ queue: [], order: [], position: 0, repeatMode: 'off', shuffle: false });
  });

  it('makes the song the one that plays after the current track', () => {
    useQueueStore.getState().setQueue([song('a'), song('b'), song('c')], 0);
    useQueueStore.getState().playNext(song('x'));
    expect(playOrder()).toEqual(['a', 'x', 'b', 'c']);
    expect(useQueueStore.getState().peekNext()?.id).toBe('x');
    expect(useQueueStore.getState().currentSong()?.id).toBe('a');
  });

  it('is what advanceOnEnded moves to, and the rest of the queue carries on after it', () => {
    useQueueStore.getState().setQueue([song('a'), song('b')], 0);
    useQueueStore.getState().playNext(song('x'));
    expect(useQueueStore.getState().advanceOnEnded()?.id).toBe('x');
    expect(useQueueStore.getState().advanceOnEnded()?.id).toBe('b');
  });

  it('works while shuffled and keeps prefetch look-ahead pointing at the new song', () => {
    useQueueStore.getState().setQueue([song('a'), song('b'), song('c'), song('d')], 0);
    useQueueStore.getState().toggleShuffle();
    useQueueStore.getState().playNext(song('x'));
    expect(useQueueStore.getState().peekUpcoming(1).map((s) => s.id)).toEqual(['x']);
  });

  it('starts the queue when it was empty', () => {
    useQueueStore.getState().playNext(song('x'));
    expect(playOrder()).toEqual(['x']);
  });
});
