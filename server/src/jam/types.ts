/** Opaque song shape — the server never reads song fields itself (only stores/relays
 * them), so it doesn't need the frontend's full `Song` type. `id` is the only field
 * any reducer logic actually depends on. */
export interface JamSong {
  id: string;
  [key: string]: unknown;
}

export type RepeatMode = 'off' | 'all' | 'one';

export interface RoomQueueState {
  queue: JamSong[];
  order: number[];
  position: number;
  repeatMode: RepeatMode;
  shuffle: boolean;
}

export interface RoomTransportState {
  isPlaying: boolean;
  positionSec: number;
  lastUpdatedAtMs: number;
}

export interface RoomSnapshot extends RoomQueueState, RoomTransportState {
  memberCount: number;
}

export type JamIntent =
  | { type: 'add-to-queue'; payload: { song: JamSong } }
  | { type: 'remove-from-queue'; payload: { orderPosition: number } }
  | { type: 'reorder'; payload: { fromPosition: number; toPosition: number } }
  | { type: 'toggle-shuffle' }
  | { type: 'cycle-repeat' }
  | { type: 'play-at-position'; payload: { orderPosition: number } }
  | { type: 'set-queue'; payload: { songs: JamSong[]; startAt?: number } }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'toggle-play' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'seek'; payload: { positionSec: number } }
  | { type: 'advance-on-ended'; payload: { songId: string } }
  | { type: 'heartbeat'; payload: { positionSec: number; isPlaying: boolean } };
