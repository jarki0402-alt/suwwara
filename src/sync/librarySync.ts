import { fetchLibrarySnapshot, pushLibrarySnapshot } from '../api/authClient';
import { useLibraryStore } from '../stores/libraryStore';

const PUSH_DEBOUNCE_MS = 800;
let pushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Best-effort write-through sync of likedSongs/playlists to the backend
 * (server/src/routes/library.ts), so pairing a second device to the same
 * account (see PairDeviceSheet) actually shows the same library there. Local
 * Zustand `persist`-to-localStorage stays the source of truth for this
 * device's own reads/writes — this only pushes changes out and, once at
 * boot, pulls them in if the server has data this device doesn't.
 *
 * Deliberately whole-snapshot and debounced, not per-mutation: at this app's
 * scale (a few hundred songs at most) resending the whole liked/playlists
 * array on every change is simpler than diffing, and failures are silent —
 * same fire-and-forget philosophy as prefetchAudioResolveOnly in
 * musicClient.ts. A failed push just means the next change retries it.
 */
export function initLibrarySync(): void {
  void hydrateFromServerIfEmpty();

  useLibraryStore.subscribe((state, prevState) => {
    if (state.likedSongs === prevState.likedSongs && state.playlists === prevState.playlists) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      void pushLibrarySnapshot({ likedSongs: state.likedSongs, playlists: state.playlists }).catch(() => {
        // Best-effort — the next local change will retry with a fresh snapshot.
      });
    }, PUSH_DEBOUNCE_MS);
  });
}

/** Only hydrates when this device's local library is empty (fresh install, or just paired) — never overwrites data the user already has locally. */
async function hydrateFromServerIfEmpty(): Promise<void> {
  const local = useLibraryStore.getState();
  if (local.likedSongs.length > 0 || local.playlists.length > 0) return;

  try {
    const remote = await fetchLibrarySnapshot();
    if (remote.likedSongs.length > 0 || remote.playlists.length > 0) {
      useLibraryStore.setState({ likedSongs: remote.likedSongs, playlists: remote.playlists });
    }
  } catch {
    // Offline or backend unavailable at boot — local store (empty) stays as-is.
  }
}
