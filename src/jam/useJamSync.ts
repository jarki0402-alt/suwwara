import { useEffect } from 'react';
import { useToast } from '../components/Toast/ToastProvider';
import { useJamStore } from '../stores/jamStore';
import { useQueueStore } from '../stores/queueStore';
import { openJamStream } from './jamClient';

// role/roomId are persisted (see jamStore.ts) specifically so a PWA tab that
// gets reloaded by the OS while backgrounded (e.g. switching away to actually
// share the Jam link) reconnects to the same room on its own once reopened,
// instead of silently falling out of the Jam with no indication. If the room
// no longer exists by then (ended, or garbage-collected — see roomManager.ts)
// the very first `room-state` never arrives; this is how long to wait before
// giving up and falling back to solo. Deliberately generous (not a liveness
// check, just an eventual-giveup safety net): a real network path — mobile
// data, a reverse proxy/tunnel (e.g. Cloudflare Tunnel) in front of the
// backend, a phone waking its browser back up from being backgrounded — can
// easily take several seconds just to re-establish the connection, well
// before the room itself is even reachable. An 8s value tested fine over
// localhost but was measured to fire falsely (kicking a device out of a Jam
// that was still very much alive) over exactly that kind of real path.
const ROOM_RECONNECT_TIMEOUT_MS = 25000;

/**
 * Mounted once (in AppShell). While solo, this is a no-op. While a Jam is
 * active, it owns the SSE connection and mirrors every broadcast straight
 * into the existing queueStore/jamStore — deliberately NOT a parallel
 * playback implementation: overwriting queueStore here is what makes the
 * *existing* load/crossfade effect in usePlaybackController.ts react and play
 * the right track for every participant, solo-mode code path unchanged.
 */
export function useJamSync() {
  const role = useJamStore((s) => s.role);
  const roomId = useJamStore((s) => s.roomId);
  const clientId = useJamStore((s) => s.clientId);
  const { showToast } = useToast();

  useEffect(() => {
    if (role !== 'jam' || !roomId) return;

    let connected = false;
    const giveUpTimer = setTimeout(() => {
      if (connected) return;
      source.close();
      const snapshot = useJamStore.getState().exitJam();
      if (snapshot) useQueueStore.setState(snapshot);
      showToast('Room Jam tidak ditemukan lagi — mungkin sudah berakhir.', { type: 'error' });
    }, ROOM_RECONNECT_TIMEOUT_MS);

    const source = openJamStream(roomId, clientId, {
      onRoomState: (snapshot) => {
        connected = true;
        clearTimeout(giveUpTimer);
        useQueueStore.setState({
          queue: snapshot.queue,
          order: snapshot.order,
          position: snapshot.position,
          repeatMode: snapshot.repeatMode,
          shuffle: snapshot.shuffle,
        });
        useJamStore.getState().setPlaybackMeta({
          isPlaying: snapshot.isPlaying,
          positionSec: snapshot.positionSec,
          lastUpdatedAtMs: snapshot.lastUpdatedAtMs,
        });
        useJamStore.getState().setMemberCount(snapshot.memberCount);
      },
      onQueue: (payload) => {
        useQueueStore.setState({
          queue: payload.queue,
          order: payload.order,
          position: payload.position,
          repeatMode: payload.repeatMode,
          shuffle: payload.shuffle,
        });
      },
      onTransport: (payload) => {
        useJamStore.getState().setPlaybackMeta(payload);
      },
      onPresence: (payload) => {
        useJamStore.getState().setMemberCount(payload.memberCount);
      },
      onRoomClosed: () => {
        const snapshot = useJamStore.getState().exitJam();
        if (snapshot) useQueueStore.setState(snapshot);
        showToast('Jam sudah berakhir.');
      },
    });

    return () => {
      clearTimeout(giveUpTimer);
      source.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, roomId, clientId]);
}
