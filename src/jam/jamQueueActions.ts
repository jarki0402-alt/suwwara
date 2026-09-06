import type { Song } from '../api/types';
import { useJamStore } from '../stores/jamStore';
import { useQueueStore } from '../stores/queueStore';
import { sendJamIntent } from './jamClient';

/**
 * Drop-in replacements for the queueStore actions of the same name — every UI
 * call site that mutates the shared queue (add/remove/reorder/shuffle/repeat/
 * jump-to-track/replace-queue) goes through here instead of calling
 * `useQueueStore` directly. In solo mode this delegates straight through with
 * zero behavior change; while a Jam is active, it sends the equivalent intent
 * to the server instead — the actual queueStore mutation then arrives for
 * every participant (including whoever tapped) via the `queue` SSE broadcast
 * handled in useJamSync.ts, so nobody's local action ever wins locally first.
 */

function jamContext(): { roomId: string; clientId: string } | null {
  const { role, roomId, clientId } = useJamStore.getState();
  if (role !== 'jam' || !roomId) return null;
  return { roomId, clientId };
}

export function addToQueue(song: Song): void {
  const ctx = jamContext();
  if (!ctx) {
    useQueueStore.getState().addToQueue(song);
    return;
  }
  void sendJamIntent(ctx.roomId, ctx.clientId, 'add-to-queue', { song });
}

export function removeFromQueue(orderPosition: number): void {
  const ctx = jamContext();
  if (!ctx) {
    useQueueStore.getState().removeFromQueue(orderPosition);
    return;
  }
  void sendJamIntent(ctx.roomId, ctx.clientId, 'remove-from-queue', { orderPosition });
}

export function reorder(fromPosition: number, toPosition: number): void {
  const ctx = jamContext();
  if (!ctx) {
    useQueueStore.getState().reorder(fromPosition, toPosition);
    return;
  }
  void sendJamIntent(ctx.roomId, ctx.clientId, 'reorder', { fromPosition, toPosition });
}

export function toggleShuffle(): void {
  const ctx = jamContext();
  if (!ctx) {
    useQueueStore.getState().toggleShuffle();
    return;
  }
  void sendJamIntent(ctx.roomId, ctx.clientId, 'toggle-shuffle');
}

export function cycleRepeat(): void {
  const ctx = jamContext();
  if (!ctx) {
    useQueueStore.getState().cycleRepeat();
    return;
  }
  void sendJamIntent(ctx.roomId, ctx.clientId, 'cycle-repeat');
}

export function playAtPosition(orderPosition: number): void {
  const ctx = jamContext();
  if (!ctx) {
    useQueueStore.getState().playAtPosition(orderPosition);
    return;
  }
  void sendJamIntent(ctx.roomId, ctx.clientId, 'play-at-position', { orderPosition });
}

export function setQueue(songs: Song[], startAt = 0): void {
  const ctx = jamContext();
  if (!ctx) {
    useQueueStore.getState().setQueue(songs, startAt);
    return;
  }
  void sendJamIntent(ctx.roomId, ctx.clientId, 'set-queue', { songs, startAt });
}

/** Whether extra auto-fill logic (radio queue extension) is allowed to run
 * locally right now — in solo mode always yes; in a Jam, only the room's
 * creator runs it (purely to avoid several devices independently adding
 * different filler songs at once — not a control-permission restriction). */
export function canAutoExtendQueue(): boolean {
  const { role, isCreator } = useJamStore.getState();
  return role === 'solo' || isCreator;
}
