import { useEffect } from 'react';
import { useToast } from '../components/Toast/ToastProvider';
import { useJamStore } from '../stores/jamStore';
import { useQueueStore } from '../stores/queueStore';
import { joinRoom, openJamStream } from './jamClient';

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
// After the browser gives up on the stream (see stream.onerror below): how many times to reopen it, and how long to
// wait — 2s, 4s, 6s … up to 10s — so a backend restart of up to about a minute is ridden out.
const JAM_MAX_REOPEN_ATTEMPTS = 8;
const JAM_REOPEN_BASE_MS = 2000;
const JAM_REOPEN_MAX_MS = 10_000;

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
    let disposed = false;
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let reopenAttempts = 0;

    const leaveJam = (message: string, type?: 'error') => {
      disposed = true;
      clearTimeout(retryTimer);
      source?.close();
      const snapshot = useJamStore.getState().exitJam();
      if (snapshot) useQueueStore.setState(snapshot);
      showToast(message, type ? { type } : undefined);
    };

    const giveUpTimer = setTimeout(() => {
      if (connected) return;
      leaveJam('Room Jam tidak ditemukan lagi — mungkin sudah berakhir.', 'error');
    }, ROOM_RECONNECT_TIMEOUT_MS);

    const open = () => {
      const stream = openJamStream(roomId, clientId, {
        onRoomState: (snapshot) => {
          connected = true;
          reopenAttempts = 0;
          clearTimeout(giveUpTimer);
          useJamStore.getState().setConnection('live');
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
            lastUpdatedAtMs: Date.now(),
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
          useJamStore.getState().setPlaybackMeta({ ...payload, lastUpdatedAtMs: Date.now() });
        },
        onPresence: (payload) => {
          useJamStore.getState().setMemberCount(payload.memberCount);
        },
        onRoomClosed: () => {
          disposed = true;
          clearTimeout(retryTimer);
          const snapshot = useJamStore.getState().exitJam();
          if (snapshot) useQueueStore.setState(snapshot);
          showToast('Jam sudah berakhir.');
        },
      });
      source = stream;

      // A network drop leaves the stream CONNECTING and the browser retries by itself; the UI just says so (the
      // room-state that follows a successful reconnect flips it back to live). An HTTP error answer (a proxy 502 while
      // the backend restarts, a 404 for a room that is gone) CLOSES the stream for good — the browser never retries
      // that, which used to leave the Jam looking active while nothing synced.
      stream.onerror = () => {
        if (disposed) return;
        useJamStore.getState().setConnection('reconnecting');
        if (stream.readyState !== EventSource.CLOSED) return;
        stream.close();
        // Ask the server whether the room still exists: a definite "not found" means it is gone (the backend
        // restarted, or the host ended it) and there is nothing to wait for; anything else (backend still down, a
        // proxy error) is transient, so try again.
        void joinRoom(roomId, clientId).then(
          () => scheduleReopen(),
          (error: unknown) => {
            if (disposed) return;
            if (error instanceof Error && /not found/i.test(error.message)) leaveJam('Jam sudah berakhir atau room-nya sudah tidak ada.', 'error');
            else scheduleReopen();
          },
        );
      };
    };

    const scheduleReopen = () => {
      if (disposed) return;
      reopenAttempts += 1;
      if (reopenAttempts > JAM_MAX_REOPEN_ATTEMPTS) {
        leaveJam('Terputus dari Jam — tidak bisa tersambung lagi.', 'error');
        return;
      }
      retryTimer = setTimeout(open, Math.min(JAM_REOPEN_BASE_MS * reopenAttempts, JAM_REOPEN_MAX_MS));
    };
    open();

    return () => {
      disposed = true;
      clearTimeout(giveUpTimer);
      clearTimeout(retryTimer);
      source?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, roomId, clientId]);
}
