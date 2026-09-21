import { describe, expect, it } from 'vitest';
import { playNext, setQueue } from '../../server/src/jam/queueReducer';
import type { RoomQueueState } from '../../server/src/jam/types';

const song = (id: string) => ({ id });
const base = (): RoomQueueState => ({ queue: [], order: [], position: 0, repeatMode: 'off', shuffle: false });
const playOrder = (state: RoomQueueState) => state.order.map((index) => state.queue[index].id);

describe('playNext (server mirror of queueStore.playNext)', () => {
  it('puts the song right after the one playing, ahead of everything already queued', () => {
    let state = setQueue(base(), [song('a'), song('b'), song('c')], 0);
    state = playNext(state, song('x'));
    expect(playOrder(state)).toEqual(['a', 'x', 'b', 'c']);
    expect(state.position).toBe(0);
  });

  it('inserts after the current track when it is mid-queue, and leaves the current track playing', () => {
    let state = setQueue(base(), [song('a'), song('b'), song('c')], 1);
    state = playNext(state, song('x'));
    expect(playOrder(state)).toEqual(['a', 'b', 'x', 'c']);
    expect(state.queue[state.order[state.position]].id).toBe('b');
  });

  it('stacks: the most recent "play next" plays first', () => {
    let state = setQueue(base(), [song('a'), song('b')], 0);
    state = playNext(playNext(state, song('x')), song('y'));
    expect(playOrder(state)).toEqual(['a', 'y', 'x', 'b']);
  });

  it('starts a queue when it is empty', () => {
    const state = playNext(base(), song('x'));
    expect(playOrder(state)).toEqual(['x']);
    expect(state.position).toBe(0);
  });

  it('follows the shuffled play order, not the list order', () => {
    const shuffled: RoomQueueState = { queue: [song('a'), song('b'), song('c')], order: [1, 2, 0], position: 0, repeatMode: 'off', shuffle: true };
    expect(playOrder(playNext(shuffled, song('x')))).toEqual(['b', 'x', 'c', 'a']);
  });

  it('at the queue cap, drops from the far end and never the current or the next track', () => {
    const songs = Array.from({ length: 200 }, (_, i) => song(`s${i}`));
    let state = setQueue(base(), songs, 0);
    state = playNext(state, song('x'));
    expect(state.queue).toHaveLength(200);
    expect(playOrder(state).slice(0, 2)).toEqual(['s0', 'x']);
    expect(playOrder(state)).not.toContain('s199');
  });
});
