import { reportPlayback } from './playbackReports';

/**
 * Android: catches the ways music can stop in the background WITHOUT the page getting to say so. The existing reports
 * (system_pause, session_hold, takeover_pause, ...) all run from a 'pause' event inside the page; when the system
 * freezes the page or kills the app's process outright (Samsung's sleeping apps, an aggressive battery saver, low
 * memory) no event runs and nothing was ever reported, which is exactly the "it just stopped, I had to tap play again"
 * that could not be explained from the admin console.
 *
 * A small note is written to localStorage while music plays in the background and cleared when the app comes back:
 * - still there when the app STARTS: the process died while playing (killed_in_background). Swiping the app away from
 *   recents also ends up here, which the detail says so it can be told apart from a report that comes back every time.
 * - back in front with the music not playing and no pause event seen: frozen, then stopped (stopped_silently).
 * - back in front, "playing", but the playhead barely moved for the time away: the page was frozen (frozen_in_background).
 */
const KEY = 'suwwara.backgroundPlay';
// Under this, the time away is too short to tell a frozen page from ordinary buffering.
const MIN_AWAY_MS = 15_000;

interface Note {
  at: number;
  song: string;
  positionSec: number;
}

export interface WatchedPlayer {
  isPlaying: () => boolean;
  songName: () => string;
  positionSec: () => number;
  element: () => HTMLMediaElement | null;
}

function read(): Note | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null') as Note | null;
  } catch {
    return null;
  }
}

function write(note: Note | null): void {
  try {
    if (note) localStorage.setItem(KEY, JSON.stringify(note));
    else localStorage.removeItem(KEY);
  } catch {
    // storage blocked: the watch just stays blind, playback is unaffected
  }
}

const seconds = (ms: number) => Math.round(ms / 1000);

let started = false;

export function startBackgroundWatch(player: WatchedPlayer): void {
  if (started || typeof document === 'undefined') return;
  started = true;

  const left = read();
  if (left) {
    write(null);
    reportPlayback(
      'killed_in_background',
      `App dimulai ulang padahal terakhir sedang memutar di background (ditinggal ${seconds(Date.now() - left.at)} dtk): proses dimatikan sistem, atau app ditutup dari daftar app terbaru · ${left.song}`,
    );
  }

  // In memory for the checks on return; the stored note is only for the case where the page does not live to return.
  let away: Note | null = null;
  let pauseSeen = false;
  let watched: HTMLMediaElement | null = null;
  const onPause = () => {
    if (document.visibilityState !== 'hidden') return;
    pauseSeen = true;
    // Paused (from the notification, a call, the system): a later kill no longer stops any music. A system pause has
    // its own report (system_pause); if it is resumed, 'playing' writes the note again.
    write(null);
  };
  const onPlaying = () => {
    if (document.visibilityState === 'hidden') write({ at: away?.at ?? Date.now(), song: player.songName(), positionSec: player.positionSec() });
  };
  const unwatch = () => {
    watched?.removeEventListener('pause', onPause);
    watched?.removeEventListener('playing', onPlaying);
    watched = null;
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      pauseSeen = false;
      away = null;
      if (!player.isPlaying()) return;
      away = { at: Date.now(), song: player.songName(), positionSec: player.positionSec() };
      write(away);
      unwatch();
      watched = player.element();
      watched?.addEventListener('pause', onPause);
      watched?.addEventListener('playing', onPlaying);
      return;
    }
    write(null);
    unwatch();
    const note = away;
    away = null;
    if (!note) return;
    const awayMs = Date.now() - note.at;
    if (awayMs < MIN_AWAY_MS) return;
    if (!player.isPlaying() && !pauseSeen) {
      reportPlayback('stopped_silently', `Musik berhenti selama ${seconds(awayMs)} dtk di background tanpa event pause (halaman dibekukan sistem) · ${note.song} → ${player.songName()}`);
    } else if (player.isPlaying() && player.songName() === note.song && player.positionSec() - note.positionSec < awayMs / 1000 / 3) {
      reportPlayback('frozen_in_background', `Halaman dibekukan di background: ${seconds(awayMs)} dtk berlalu, lagu cuma maju ${Math.round(player.positionSec() - note.positionSec)} dtk · ${note.song}`);
    }
  });
}
