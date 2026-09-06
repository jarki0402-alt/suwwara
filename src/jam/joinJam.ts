import { useJamStore } from '../stores/jamStore';
import { joinRoom } from './jamClient';
import { currentQueueSnapshot } from './queueSnapshot';

export type JoinJamResult = { ok: true } | { ok: false; reason: 'not-found' | 'error' };

/** Shared by JoinJamSheet (opened via a `?jam=<roomId>` link) and JamSheet's
 * "Gabung pakai kode" input — a manual code entry exists because opening a
 * share link on most platforms just opens the browser, not the installed
 * PWA, so the link alone can't be relied on to get someone into the app. */
export async function joinJamRoom(roomId: string): Promise<JoinJamResult> {
  const clientId = useJamStore.getState().clientId;
  try {
    const snapshot = await joinRoom(roomId, clientId);
    if (!snapshot) return { ok: false, reason: 'not-found' };
    useJamStore.getState().enterJam({ roomId, isCreator: false, queueSnapshotToRestore: currentQueueSnapshot() });
    return { ok: true };
  } catch {
    return { ok: false, reason: 'error' };
  }
}
