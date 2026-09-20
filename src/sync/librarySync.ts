import { ApiHttpError, fetchLibrarySnapshot, pushLibrarySnapshot, registerThisDevice, type LibrarySnapshot } from '../api/authClient';
import { describeThisDevice } from '../auth/deviceInfo';
import { useLibraryStore } from '../stores/libraryStore';

const PUSH_DEBOUNCE_MS = 800;
const POLL_INTERVAL_MS = 30_000;
const VERSION_KEY = 'suwwara-library-version';

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pushInFlight = false;
// A save failed (offline, backend hiccup) and hasn't been retried yet: local edits must not be overwritten by a pull first.
let dirty = false;
// True while a snapshot that came FROM the server is being written into the store, so the
// store subscription below doesn't bounce it straight back as if the user had edited it.
let applyingRemote = false;
let syncedVersion = readVersion();
let started = false;

function readVersion(): number {
  try {
    return Number(localStorage.getItem(VERSION_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveVersion(version: number): void {
  syncedVersion = version;
  try {
    localStorage.setItem(VERSION_KEY, String(version));
  } catch {
    // private mode — the in-memory value still works for this session
  }
}

function unionById<T extends { id: string }>(preferred: T[], other: T[]): T[] {
  const seen = new Set(preferred.map((item) => item.id));
  return [...preferred, ...other.filter((item) => !seen.has(item.id))];
}

/** Nothing is dropped (see server/src/library/merge.ts for the trade-off). */
function merge(preferred: LibrarySnapshot, other: LibrarySnapshot): LibrarySnapshot {
  return {
    likedSongs: unionById(preferred.likedSongs, other.likedSongs),
    playlists: unionById(preferred.playlists, other.playlists),
  };
}

function currentLocal(): LibrarySnapshot {
  const { likedSongs, playlists } = useLibraryStore.getState();
  return { likedSongs, playlists };
}

function applyToStore(snapshot: LibrarySnapshot): void {
  applyingRemote = true;
  try {
    useLibraryStore.setState({ likedSongs: snapshot.likedSongs, playlists: snapshot.playlists });
  } finally {
    applyingRemote = false;
  }
}

/**
 * Keeps likedSongs/playlists in step across every device linked to the account
 * (server/src/routes/library.ts). localStorage (Zustand `persist`) stays the source of truth
 * for this device's own reads and writes; this pushes changes out, and pulls in what other
 * devices changed.
 *
 * Whole-snapshot and debounced on purpose (a few hundred songs at most — resending the whole
 * thing is simpler than diffing), but no longer blind last-write-wins: every save names the
 * version it was based on. If another device saved in between, the server refuses (409) and
 * sends its copy; the two are merged (nothing dropped) and saved again.
 *
 * Failures are silent and retried by the next change, poll or resume — same fire-and-forget
 * philosophy as prefetchAudioResolveOnly in musicClient.ts.
 */
export function initLibrarySync(): void {
  if (started) return;
  started = true;

  const info = describeThisDevice();
  void registerThisDevice(info.name, info.kind).catch(() => {});
  void pullLibrary();

  useLibraryStore.subscribe((state, prevState) => {
    if (applyingRemote) return;
    if (state.likedSongs === prevState.likedSongs && state.playlists === prevState.playlists) return;
    schedulePush();
  });

  // Other devices' changes arrive by polling a tiny "anything newer than v?" request, and
  // straight away when the app comes back to the foreground (where a phone spends its life).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void pullLibrary();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') void pullLibrary();
  }, POLL_INTERVAL_MS);
}

/** After this device was linked to another account: version numbers of the old and new account aren't comparable, so start over and merge. */
export function resyncAfterLink(): Promise<void> {
  saveVersion(0);
  return pullLibrary();
}

function schedulePush(): void {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    void pushLibrary();
  }, PUSH_DEBOUNCE_MS);
}

export async function pullLibrary(): Promise<void> {
  // Unsaved local edits would be overwritten by whatever we pull — save first, pull after.
  if (pushTimer || pushInFlight) return;
  if (dirty) {
    void pushLibrary();
    return;
  }
  try {
    const remote = await fetchLibrarySnapshot(syncedVersion);
    if (remote.unchanged) return;
    const local = currentLocal();
    const localHasData = local.likedSongs.length > 0 || local.playlists.length > 0;

    if (syncedVersion === 0 && localHasData) {
      // First time this device meets the server's copy while holding its own: keep both.
      const merged = merge(remote, local);
      applyToStore(merged);
      saveVersion(remote.version);
      if (merged.likedSongs.length !== remote.likedSongs.length || merged.playlists.length !== remote.playlists.length) schedulePush();
      return;
    }
    applyToStore({ likedSongs: remote.likedSongs, playlists: remote.playlists });
    saveVersion(remote.version);
  } catch {
    // offline / backend unavailable — try again on the next poll or resume
  }
}

async function pushLibrary(retryOnConflict = true): Promise<void> {
  if (pushInFlight) return;
  pushInFlight = true;
  try {
    const result = await pushLibrarySnapshot(currentLocal(), syncedVersion);
    saveVersion(result.version);
    dirty = false;
  } catch (error) {
    if (error instanceof ApiHttpError && error.status === 409) {
      // Another linked device saved first. Merge its copy with ours, keep ours where they collide.
      const body = error.body as LibrarySnapshot & { version: number };
      applyToStore(merge(currentLocal(), { likedSongs: body.likedSongs, playlists: body.playlists }));
      saveVersion(body.version);
      pushInFlight = false;
      if (retryOnConflict) await pushLibrary(false);
      return;
    }
    // Anything else: silent. Marked dirty so the next poll/resume retries the save before pulling.
    dirty = true;
  } finally {
    pushInFlight = false;
  }
}
