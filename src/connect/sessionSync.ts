import type { Song } from '../api/types';
import { audioEngine } from '../audio-engine/AudioEngine';
import { notifyUnauthorized } from '../auth/authStore';
import { getDeviceId } from '../auth/deviceIdentity';
import { useJamStore } from '../stores/jamStore';
import { useQueueStore, type RepeatMode } from '../stores/queueStore';
import { projectedPosition, useConnectStore, type RemoteDevice } from './connectStore';
import { holdNextLoad, peekResumePoint, setResumePoint } from './sessionHold';

/**
 * One playback session per account (Spotify Connect). The running queue lives on the server; every device mirrors it
 * in its own queueStore, and whichever device is playing is the one that makes sound — the others are remotes for it.
 *
 * Only data moves here, never audio: the playing device still plays through the exact same controller → AudioEngine →
 * /api/audio path as before. A remote's edits (tap a song, reorder, skip) are applied to its own mirror at once (so its
 * screen answers instantly) and published; the playing device adopts them, which its controller then acts on like any
 * local change. One message type, both directions — so there is no separate remote-queue protocol to keep in step.
 *
 * Cheap by construction: the whole queue only travels when the queue itself changes (a revision id stands in for it
 * otherwise), the playhead is never streamed (remotes project it from the Connect heartbeat), and nothing here runs
 * per frame.
 */

const STORAGE_KEY = 'suwwara-session';
// The playing device's own changes: nobody is waiting on them, so coalesce a burst (skipping through several songs).
const PUBLISH_DELAY_MS = 400;
// A remote's edit: the other device is waiting to play it — send it almost at once.
const REMOTE_PUBLISH_DELAY_MS = 40;
// Where the playing device is, saved now and then so another device can carry on after this one is closed.
const POSITION_SAVE_MS = 15_000;
// After this device hands playback over (or takes it), the devices' reports lag a moment behind; the follow rule
// waits that out instead of acting on the stale picture and undoing the move.
const FOLLOW_GRACE_MS = 3_000;
// A remote whose mirror shows a different song than the device it follows reports, for longer than a report takes to
// land, missed an update (a dropped stream): fetch the session again.
const MISMATCH_REFRESH_MS = 1_500;

export interface SessionPayload {
  from?: string;
  updatedAt: number;
  queueRev: string;
  queue?: Song[];
  order: number[];
  position: number;
  repeatMode: RepeatMode;
  shuffle: boolean;
  songId: string | null;
  activeRef: string | null;
  positionSec?: number;
}

let running = false;
let stopFns: (() => void)[] = [];
// Which revision the local queue array is (and the array itself, compared by reference), and the revision the server
// is known to hold — together they decide whether an update has to carry the whole queue.
let localRev = '';
let localQueueRef: Song[] | null = null;
let serverRev: string | null = null;
// Newest session version this device has seen or written; anything not newer is old news.
let lastSeenAt = 0;
let adopting = false;
let editedSinceBoot = false;
let publishTimer: ReturnType<typeof setTimeout> | null = null;
let positionTimer: ReturnType<typeof setInterval> | null = null;
let mismatchTimer: ReturnType<typeof setTimeout> | null = null;
let refreshing = false;
let suppressFollowUntil = 0;
let evaluating = false;
let lastFollowed: RemoteDevice | null = null;

const authHeaders = () => ({ Authorization: `Bearer ${getDeviceId()}` });
const isSolo = () => useJamStore.getState().role === 'solo';
const engineBusy = () => {
  const status = audioEngine.getSnapshot().status;
  return status === 'playing' || status === 'loading';
};
const newRev = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

function persistMeta(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ rev: localRev, at: lastSeenAt }));
  } catch {
    // private mode / storage full: the next boot just fetches the queue once more
  }
}

function restoreMeta(): void {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as { rev?: unknown; at?: unknown } | null;
    if (typeof saved?.rev === 'string') localRev = saved.rev;
    if (typeof saved?.at === 'number') lastSeenAt = saved.at;
  } catch {
    // unreadable: start fresh
  }
  // The persisted queue is that revision (queueStore rehydrates synchronously from localStorage before this runs).
  localQueueRef = useQueueStore.getState().queue;
  if (!localRev && localQueueRef.length > 0) localRev = newRev();
  serverRev = localRev || null;
}

/** Keeps the follow rule from reacting to the devices' reports while a hand-over settles. */
export function suppressFollow(ms = FOLLOW_GRACE_MS): void {
  suppressFollowUntil = Date.now() + ms;
}

export function startSessionSync(): () => void {
  if (running) return stopSessionSync;
  running = true;
  restoreMeta();

  stopFns.push(
    useQueueStore.subscribe((state, prev) => {
      if (state.queue === prev.queue && state.order === prev.order && state.position === prev.position && state.repeatMode === prev.repeatMode && state.shuffle === prev.shuffle) return;
      // A Jam's room owns the queue meanwhile; the account session waits, untouched, until the Jam is left.
      if (adopting || !isSolo()) return;
      editedSinceBoot = true;
      if (state.queue !== localQueueRef) {
        localQueueRef = state.queue;
        localRev = newRev();
      }
      schedulePublish();
    }),
  );

  let previousStatus = audioEngine.getSnapshot().status;
  stopFns.push(
    audioEngine.subscribe((state) => {
      // Starting to play makes this device the one the session plays on — say so, even when the queue itself is the
      // one restored from last time (nothing else would publish it, and the other devices would have nothing to show).
      if (state.status === 'playing' && previousStatus !== 'playing' && isSolo() && !useConnectStore.getState().controllingRef) schedulePublish();
      previousStatus = state.status;
      if (state.status === 'playing') {
        positionTimer ??= setInterval(() => savePosition(false), POSITION_SAVE_MS);
      } else if (positionTimer) {
        clearInterval(positionTimer);
        positionTimer = null;
        if (state.status === 'paused') savePosition(false);
      }
      evaluateFollow();
    }),
  );

  stopFns.push(
    useConnectStore.subscribe((state, prev) => {
      if (state.controllingRef) {
        const followed = state.devices.find((device) => device.ref === state.controllingRef);
        if (followed) lastFollowed = followed;
      } else if (prev.controllingRef && lastFollowed?.ref === prev.controllingRef) {
        // Stopped following (that device went away, or this one took over): carry on from where it was, not from 0.
        const songId = lastFollowed.state?.song?.id;
        if (songId && useQueueStore.getState().currentSong()?.id === songId && peekResumePoint(songId) === null) {
          setResumePoint(songId, projectedPosition(lastFollowed));
        }
        lastFollowed = null;
      }
      if (state.devices !== prev.devices || state.controllingRef !== prev.controllingRef) evaluateFollow();
    }),
  );

  const onHidden = () => {
    if (document.visibilityState === 'hidden') savePosition(true);
  };
  const onOnline = () => {
    if (editedSinceBoot) schedulePublish();
  };
  document.addEventListener('visibilitychange', onHidden);
  window.addEventListener('online', onOnline);
  stopFns.push(() => {
    document.removeEventListener('visibilitychange', onHidden);
    window.removeEventListener('online', onOnline);
  });

  void bootstrap();
  return stopSessionSync;
}

export function stopSessionSync(): void {
  running = false;
  for (const stop of stopFns) stop();
  stopFns = [];
  if (publishTimer) clearTimeout(publishTimer);
  if (positionTimer) clearInterval(positionTimer);
  if (mismatchTimer) clearTimeout(mismatchTimer);
  publishTimer = positionTimer = mismatchTimer = null;
}

function schedulePublish(): void {
  if (publishTimer) clearTimeout(publishTimer);
  const delay = useConnectStore.getState().controllingRef ? REMOTE_PUBLISH_DELAY_MS : PUBLISH_DELAY_MS;
  publishTimer = setTimeout(() => {
    publishTimer = null;
    void publish(false);
  }, delay);
}

async function publish(withQueue: boolean): Promise<void> {
  if (!running || !isSolo()) return;
  const state = useQueueStore.getState();
  const song = state.currentSong();
  const followingRef = useConnectStore.getState().controllingRef;
  const rev = localRev || (localRev = newRev());
  // A remote doesn't know the playhead (the server keeps it, or resets it for a new song); the device holding the
  // session says where it is.
  const playhead = followingRef
    ? {}
    : audioEngine.getCurrentSong()?.id === song?.id
      ? { positionSec: audioEngine.getCurrentTime(), isPlaying: engineBusy() }
      : { positionSec: 0 };
  const body = {
    queueRev: rev,
    ...(withQueue || serverRev !== rev ? { queue: state.queue } : {}),
    order: state.order,
    position: state.position,
    repeatMode: state.repeatMode,
    shuffle: state.shuffle,
    songId: song?.id ?? null,
    ...playhead,
    ...(followingRef ? { activeRef: followingRef } : {}),
  };
  try {
    const response = await fetch('/api/connect/session', { method: 'PUT', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    notifyUnauthorized(response.status);
    if (response.status === 409 && !withQueue) return publish(true);
    if (!response.ok) return;
    const { updatedAt } = (await response.json()) as { updatedAt: number };
    serverRev = rev;
    lastSeenAt = Math.max(lastSeenAt, updatedAt);
    persistMeta();
  } catch {
    // offline: the next change (or coming back online) publishes again
  }
}

/** An update another device published, pushed over the Connect stream. */
export function receiveSession(payload: SessionPayload): void {
  if (!running || !isSolo() || payload.updatedAt <= lastSeenAt) return;
  lastSeenAt = payload.updatedAt;
  persistMeta();
  const queue = payload.queue ?? (payload.queueRev === localRev ? localQueueRef : null);
  if (queue) apply(payload, queue, false);
  else void refresh(true);
}

/** The Connect stream (re)opened: anything published while it was down never reached this device. */
export function catchUpSession(): void {
  if (running) void refresh(false);
}

/**
 * Makes the local mirror match a session. Unless this device is the one the session plays on, the new song is put on
 * hold — shown, not loaded (see sessionHold) — so nothing ever starts sounding here because another device moved on.
 */
function apply(session: SessionPayload, queue: Song[], fromBoot: boolean): void {
  const { youRef, controllingRef } = useConnectStore.getState();
  const forThisDevice = !fromBoot && !controllingRef && session.activeRef !== null && session.activeRef === youRef;
  const next = queue[session.order[session.position] ?? -1] ?? null;
  const current = useQueueStore.getState().currentSong();
  if (!forThisDevice && next && next.id !== current?.id) holdNextLoad(next.id);
  if (fromBoot && next && typeof session.positionSec === 'number' && session.positionSec > 1) setResumePoint(next.id, session.positionSec);

  adopting = true;
  try {
    useQueueStore.setState({ queue, order: session.order, position: session.position, repeatMode: session.repeatMode, shuffle: session.shuffle });
  } finally {
    adopting = false;
  }
  localQueueRef = queue;
  localRev = session.queueRev;
  serverRev = session.queueRev;
  persistMeta();
  // A remote's edit landed on the device that plays: confirm it, so if two edits crossed on the way every device
  // still ends on what this one actually plays (the confirmation carries no queue — just the revision).
  if (forThisDevice) schedulePublish();
}

async function fetchSession(): Promise<SessionPayload | null> {
  const response = await fetch(`/api/connect/session?have=${encodeURIComponent(localRev)}`, { headers: authHeaders(), cache: 'no-store' });
  notifyUnauthorized(response.status);
  if (!response.ok) return null;
  const { session } = (await response.json()) as { session: SessionPayload | null };
  return session;
}

/**
 * On open: if another device played since this one last looked (the laptop, closed half-way through a song), show that
 * — paused, ready to carry on from its spot. Never over something already chosen or playing here.
 */
async function bootstrap(): Promise<void> {
  if (!isSolo()) return;
  try {
    const session = await fetchSession();
    if (!session || session.updatedAt <= lastSeenAt || editedSinceBoot || engineBusy() || !isSolo()) return;
    const queue = session.queue ?? (session.queueRev === localRev ? localQueueRef : null);
    if (!queue) return;
    lastSeenAt = session.updatedAt;
    apply(session, queue, true);
  } catch {
    // offline: this device's own last queue stays
  }
}

/**
 * Fetches the session again: an update arrived without a queue this device holds, the mirror drifted (`allowSame` —
 * the version may be one already seen), or the stream was down for a while.
 */
async function refresh(allowSame: boolean): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  try {
    const session = await fetchSession();
    if (!session || session.updatedAt < lastSeenAt || (!allowSame && session.updatedAt === lastSeenAt) || !isSolo()) return;
    const queue = session.queue ?? (session.queueRev === localRev ? localQueueRef : null);
    if (!queue) return;
    lastSeenAt = session.updatedAt;
    apply(session, queue, false);
  } catch {
    // try again on the next update
  } finally {
    refreshing = false;
  }
}

function savePosition(leaving: boolean): void {
  if (!running || !isSolo() || useConnectStore.getState().controllingRef) return;
  const song = audioEngine.getCurrentSong();
  if (!song || useQueueStore.getState().currentSong()?.id !== song.id) return;
  void fetch('/api/connect/session/position', {
    method: 'POST',
    // keepalive: the page may be on its way out (closed tab, PWA swiped away) — the request still has to land.
    keepalive: leaving,
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ songId: song.id, positionSec: audioEngine.getCurrentTime(), isPlaying: engineBusy() }),
  }).catch(() => {});
}

/**
 * The follow rule: while another device of the account is playing and this one isn't, this one is its remote — no
 * "Kontrol" tap needed, as in Spotify. It keeps following through that device's pauses (so play/pause never flips
 * which device sounds), and lets go when the device disappears or this one starts playing itself.
 */
export function evaluateFollow(): void {
  if (!running || evaluating) return;
  evaluating = true;
  try {
    const { devices, youRef, controllingRef, control } = useConnectStore.getState();
    if (!isSolo()) {
      if (controllingRef) control(null);
      return;
    }
    if (Date.now() < suppressFollowUntil) return;
    if (engineBusy()) {
      if (controllingRef) control(null);
      return;
    }
    const playingElsewhere = devices.find((device) => device.ref !== youRef && device.state?.isPlaying && !device.state.followingRef && !device.state.inJam);
    if (playingElsewhere && playingElsewhere.ref !== controllingRef) {
      control(playingElsewhere.ref);
      return;
    }
    const followed = controllingRef ? devices.find((device) => device.ref === controllingRef) : undefined;
    if (controllingRef && !followed) {
      control(null);
      return;
    }
    watchMismatch(followed);
  } finally {
    evaluating = false;
  }
}

function watchMismatch(followed: RemoteDevice | undefined): void {
  const remoteSongId = followed?.state?.song?.id;
  const mismatch = remoteSongId !== undefined && useQueueStore.getState().currentSong()?.id !== remoteSongId;
  if (!mismatch) {
    if (mismatchTimer) clearTimeout(mismatchTimer);
    mismatchTimer = null;
    return;
  }
  mismatchTimer ??= setTimeout(() => {
    mismatchTimer = null;
    const device = useConnectStore.getState().devices.find((candidate) => candidate.ref === useConnectStore.getState().controllingRef);
    if (device?.state?.song && useQueueStore.getState().currentSong()?.id !== device.state.song.id) void refresh(true);
  }, MISMATCH_REFRESH_MS);
}
