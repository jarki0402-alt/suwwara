import { useEffect } from 'react';
import { useToast } from '../components/Toast/ToastProvider';
import { useJamStore } from '../stores/jamStore';
import { useQueueStore } from '../stores/queueStore';
import { isRoomGone, joinRoom, openJamStream } from './jamClient';
import { t } from '../i18n/i18n';

// role/roomId are persisted (see jamStore.ts) so a PWA the OS reloaded in the background reconnects to the same room on
// its own. The app leaves a Jam by itself ONLY when the server says the room is gone (404, see isRoomGone): it used to
// also give up after ~25s without a first state, or after 8 failed reopens (about a minute), and a phone with its screen
// off is routinely without network for longer than that. People came back to find themselves out of a Jam that was
// still running for everyone else. Now a device that cannot reach the room just keeps saying "Menyambung ulang" and
// keeps trying; "Keluar" is always there if someone really wants out.
const ROOM_CHECK_AFTER_MS = 25_000;
// Reopen delays after the browser gives up on the stream: 2s, 4s, 6s ... then every 15s for as long as it takes.
const JAM_REOPEN_BASE_MS = 2000;
const JAM_REOPEN_MAX_MS = 15_000;
// The server pings every 20s. Silence for longer than two pings means the stream is dead even if the browser still
// calls it open: typical after a phone wakes on a network that dropped the connection while it slept. Without this the
// Jam looked live while no queue change or play/pause arrived.
const STREAM_SILENT_MS = 50_000;
const STREAM_WATCH_MS = 15_000;

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
    let lastHeardAt = Date.now();
    // Only judge silence once a ping has been seen, so a backend that does not send them yet never causes reopen loops.
    let pingSeen = false;
    const heard = () => {
      lastHeardAt = Date.now();
    };

    const leaveJam = (message: string, type?: 'error') => {
      disposed = true;
      clearTimeout(retryTimer);
      source?.close();
      const snapshot = useJamStore.getState().exitJam();
      if (snapshot) useQueueStore.setState(snapshot);
      showToast(message, type ? { type } : undefined);
    };

    /** Asks the server whether the room exists. Leaves only on a definite "gone"; resolves true while it may be alive. */
    const roomMayBeAlive = () =>
      joinRoom(roomId, clientId).then(
        () => true,
        (error: unknown) => {
          if (disposed) return false;
          if (isRoomGone(error)) {
            leaveJam(t('Jam sudah berakhir atau room-nya sudah tidak ada.'), 'error');
            return false;
          }
          return true;
        },
      );

    const checkTimer = setTimeout(() => {
      if (!connected && !disposed) void roomMayBeAlive();
    }, ROOM_CHECK_AFTER_MS);

    const open = () => {
      if (disposed) return;
      source?.close();
      heard();
      const stream = openJamStream(roomId, clientId, {
        onRoomState: (snapshot) => {
          heard();
          connected = true;
          reopenAttempts = 0;
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
          heard();
          useQueueStore.setState({
            queue: payload.queue,
            order: payload.order,
            position: payload.position,
            repeatMode: payload.repeatMode,
            shuffle: payload.shuffle,
          });
        },
        onTransport: (payload) => {
          heard();
          useJamStore.getState().setPlaybackMeta({ ...payload, lastUpdatedAtMs: Date.now() });
        },
        onPresence: (payload) => {
          heard();
          useJamStore.getState().setMemberCount(payload.memberCount);
        },
        onPing: () => {
          heard();
          pingSeen = true;
        },
        onRoomClosed: () => {
          disposed = true;
          clearTimeout(retryTimer);
          const snapshot = useJamStore.getState().exitJam();
          if (snapshot) useQueueStore.setState(snapshot);
          showToast(t('Jam sudah diakhiri.'));
        },
      });
      source = stream;

      // A network drop leaves the stream CONNECTING and the browser retries by itself; the UI just says so (the
      // room-state that follows a successful reconnect flips it back to live). An HTTP error answer (a proxy 502 while
      // the backend restarts, a 404 for a room that is gone) CLOSES the stream for good and the browser never retries
      // that, so it is reopened here, after asking the server whether there is still a room to reopen.
      stream.onerror = () => {
        if (disposed || stream !== source) return;
        useJamStore.getState().setConnection('reconnecting');
        if (stream.readyState !== EventSource.CLOSED) return;
        stream.close();
        void roomMayBeAlive().then((alive) => {
          if (alive) scheduleReopen();
        });
      };
    };

    const scheduleReopen = () => {
      if (disposed) return;
      clearTimeout(retryTimer);
      reopenAttempts += 1;
      retryTimer = setTimeout(open, Math.min(JAM_REOPEN_BASE_MS * reopenAttempts, JAM_REOPEN_MAX_MS));
    };

    /** Skip the backoff: the moment there is a reason to think the room is reachable again, try at once. */
    const reopenNow = () => {
      if (disposed) return;
      clearTimeout(retryTimer);
      reopenAttempts = 0;
      useJamStore.getState().setConnection('reconnecting');
      open();
    };

    const streamLooksDead = () =>
      !source || source.readyState === EventSource.CLOSED || (pingSeen && Date.now() - lastHeardAt > STREAM_SILENT_MS);

    const watch = setInterval(() => {
      if (!disposed && streamLooksDead()) reopenNow();
    }, STREAM_WATCH_MS);

    // Coming back to the app or getting network back are the moments a dropped Jam should heal, not up to 15s later.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && (streamLooksDead() || useJamStore.getState().connection !== 'live')) reopenNow();
    };
    const onOnline = () => {
      if (streamLooksDead() || useJamStore.getState().connection !== 'live') reopenNow();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);

    open();

    return () => {
      disposed = true;
      clearTimeout(checkTimer);
      clearTimeout(retryTimer);
      clearInterval(watch);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      source?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, roomId, clientId]);
}
