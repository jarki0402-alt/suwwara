import type { QueueSnapshot } from '../stores/jamStore';
import { useQueueStore } from '../stores/queueStore';

/** Picks just the data fields off queueStore — `useQueueStore.getState()`
 * itself also carries every action function, which must never be spread into
 * a snapshot that gets serialized (sent to the server) or replayed later via
 * `useQueueStore.setState(...)`. */
export function currentQueueSnapshot(): QueueSnapshot {
  const state = useQueueStore.getState();
  return {
    queue: state.queue,
    order: state.order,
    position: state.position,
    repeatMode: state.repeatMode,
    shuffle: state.shuffle,
  };
}
