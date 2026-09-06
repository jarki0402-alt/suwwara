import type { JamSong, RepeatMode, RoomQueueState } from './types';

const MAX_QUEUE_LENGTH = 200;

/**
 * Server-side mirror of the pure reducer logic in `src/stores/queueStore.ts` —
 * duplicated deliberately rather than shared across the Vite (ESM) frontend
 * build and this CommonJS backend build. MUST stay behaviorally identical to
 * that file (same function names/semantics below match 1:1) — if queueStore.ts
 * ever changes its add/remove/reorder/repeat semantics, mirror the change here.
 */

export function buildPlayOrder(length: number, shuffle: boolean, anchorIndex: number): number[] {
  const indices = Array.from({ length }, (_, i) => i);
  if (!shuffle) return indices;

  const rest = indices.filter((i) => i !== anchorIndex);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }

  return indices.includes(anchorIndex) ? [anchorIndex, ...rest] : rest;
}

export function songAt(state: RoomQueueState): JamSong | null {
  const queueIndex = state.order[state.position];
  if (queueIndex === undefined) return null;
  return state.queue[queueIndex] ?? null;
}

export function emptyQueueState(): RoomQueueState {
  return { queue: [], order: [], position: 0, repeatMode: 'off', shuffle: false };
}

export function setQueue(state: RoomQueueState, songs: JamSong[], startAt = 0): RoomQueueState {
  const capped = songs.slice(0, MAX_QUEUE_LENGTH);
  const clampedStart = Math.min(Math.max(startAt, 0), Math.max(capped.length - 1, 0));
  const order = buildPlayOrder(capped.length, state.shuffle, clampedStart);
  const position = Math.max(order.indexOf(clampedStart), 0);
  return { ...state, queue: capped, order, position };
}

export function addToQueue(state: RoomQueueState, song: JamSong): RoomQueueState {
  let working = state;
  if (working.queue.length >= MAX_QUEUE_LENGTH) {
    const dropPosition = working.order.findIndex((_, pos) => pos !== working.position);
    if (dropPosition === -1) return working;
    working = removeFromQueue(working, dropPosition);
  }
  const newQueueIndex = working.queue.length;
  return { ...working, queue: [...working.queue, song], order: [...working.order, newQueueIndex] };
}

export function removeFromQueue(state: RoomQueueState, orderPosition: number): RoomQueueState {
  const { queue, order, position } = state;
  if (orderPosition < 0 || orderPosition >= order.length) return state;
  const removedQueueIndex = order[orderPosition];

  const newQueue = queue.filter((_, i) => i !== removedQueueIndex);
  const newOrder = order
    .filter((_, i) => i !== orderPosition)
    .map((idx) => (idx > removedQueueIndex ? idx - 1 : idx));

  let newPosition = position;
  if (orderPosition < position) newPosition -= 1;
  else if (orderPosition === position) newPosition = Math.min(newPosition, newOrder.length - 1);

  return { ...state, queue: newQueue, order: newOrder, position: Math.max(newPosition, 0) };
}

export function reorder(state: RoomQueueState, fromPosition: number, toPosition: number): RoomQueueState {
  const { order, position } = state;
  if (
    fromPosition === toPosition ||
    fromPosition < 0 ||
    toPosition < 0 ||
    fromPosition >= order.length ||
    toPosition >= order.length
  ) {
    return state;
  }
  const newOrder = [...order];
  const [moved] = newOrder.splice(fromPosition, 1);
  newOrder.splice(toPosition, 0, moved);

  let newPosition = position;
  if (position === fromPosition) newPosition = toPosition;
  else if (fromPosition < position && toPosition >= position) newPosition -= 1;
  else if (fromPosition > position && toPosition <= position) newPosition += 1;

  return { ...state, order: newOrder, position: newPosition };
}

export function toggleShuffle(state: RoomQueueState): RoomQueueState {
  const { queue, order, position, shuffle } = state;
  const anchor = order[position] ?? 0;
  const nextShuffle = !shuffle;
  const newOrder = buildPlayOrder(queue.length, nextShuffle, anchor);
  return { ...state, shuffle: nextShuffle, order: newOrder, position: Math.max(newOrder.indexOf(anchor), 0) };
}

export function cycleRepeat(state: RoomQueueState): RoomQueueState {
  const next: RepeatMode = state.repeatMode === 'off' ? 'all' : state.repeatMode === 'all' ? 'one' : 'off';
  return { ...state, repeatMode: next };
}

export function playAtPosition(state: RoomQueueState, orderPosition: number): RoomQueueState {
  if (orderPosition < 0 || orderPosition >= state.order.length) return state;
  return { ...state, position: orderPosition };
}

/** User-driven skip — ignores repeatMode, unlike advanceOnEnded. */
export function next(state: RoomQueueState): RoomQueueState {
  if (state.order.length === 0) return state;
  const nextPosition = state.position + 1 >= state.order.length ? 0 : state.position + 1;
  return { ...state, position: nextPosition };
}

export function previous(state: RoomQueueState): RoomQueueState {
  if (state.order.length === 0) return state;
  const prevPosition = state.position - 1 < 0 ? state.order.length - 1 : state.position - 1;
  return { ...state, position: prevPosition };
}

/** Natural end-of-track — respects repeatMode, unlike next()/previous(). Returns
 * `null` alongside the unchanged state when the queue has genuinely run out
 * (repeatMode 'off' and already at the last track), matching queueStore's own
 * "return null" signal used to decide whether to fall back to radio extension. */
export function advanceOnEnded(state: RoomQueueState): { state: RoomQueueState; ranOut: boolean } {
  if (state.order.length === 0) return { state, ranOut: true };
  if (state.repeatMode === 'one') return { state, ranOut: false };

  const wrap = state.repeatMode === 'all';
  let nextPosition = state.position + 1;
  if (nextPosition >= state.order.length) {
    if (!wrap) return { state, ranOut: true };
    nextPosition = 0;
  }
  return { state: { ...state, position: nextPosition }, ranOut: false };
}
