import { useCallback, useEffect, useRef } from 'react';
import { bestImageUrl, primaryArtistNames } from '../api/mappers';
import { listLinkedDevices } from '../api/authClient';
import { audioEngine } from '../audio-engine/AudioEngine';
import { describeThisDevice } from '../auth/deviceInfo';
import { useToast } from '../components/Toast/ToastProvider';
import { usePlayback } from '../playback/PlaybackContext';
import { useSettingsStore } from '../stores/settingsStore';
import { setConnectToast } from './commandHandler';
import { reconnectNow, sendState, startConnect, stopConnect } from './connectClient';
import { useConnectStore } from './connectStore';

const HEARTBEAT_MS = 10_000;
const DRIFT_CHECK_MS = 2_000;
// How far the real playhead may stray from where the last report predicted before we
// re-report (a seek made on this device) instead of waiting for the next heartbeat.
const DRIFT_TOLERANCE_SEC = 1.5;

/**
 * Renders nothing. Mounted once inside PlaybackProvider, it (1) keeps the live channel open
 * only while the account has more than one device — a lone device has nobody to talk to, and
 * a permanently open stream is a cost on the small server — and (2) reports what this device
 * is playing so the others can show and control it.
 */
export function ConnectBridge() {
  const { showToast } = useToast();
  const { currentSong, playbackState } = usePlayback();
  const volume = useSettingsStore((state) => state.volume);
  const connected = useConnectStore((state) => state.connected);

  useEffect(() => {
    setConnectToast(showToast);
  }, [showToast]);

  // Run the channel only when there is someone to talk to; re-check when the app comes back
  // to the foreground and once a minute (a device of the same account may have signed in or out meanwhile —
  // there is no pairing step any more, so nothing else tells this device that someone new appeared).
  useEffect(() => {
    let cancelled = false;
    const evaluate = () => {
      listLinkedDevices()
        .then((devices) => {
          if (cancelled) return;
          if (devices.length > 1) startConnect();
          else stopConnect();
        })
        .catch(() => {});
    };
    evaluate();
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      evaluate();
      reconnectNow();
    };
    document.addEventListener('visibilitychange', onVisible);
    const recheck = setInterval(() => {
      if (document.visibilityState === 'visible') evaluate();
    }, 60_000);
    return () => {
      cancelled = true;
      clearInterval(recheck);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const isPlaying = playbackState.status === 'playing' || playbackState.status === 'loading';
  const lastSent = useRef<{ positionSec: number; isPlaying: boolean; at: number } | null>(null);

  const report = useCallback(() => {
    const positionSec = audioEngine.getCurrentTime();
    lastSent.current = { positionSec, isPlaying, at: Date.now() };
    void sendState({
      song: currentSong ? { id: currentSong.id, name: currentSong.name, artist: primaryArtistNames(currentSong), image: bestImageUrl(currentSong.image, '150x150') } : null,
      isPlaying,
      positionSec,
      durationSec: currentSong?.duration ?? 0,
      volume,
      // On iOS a web page can't change its own audio volume — the hardware buttons own it.
      canSetVolume: describeThisDevice().name !== 'iPhone' && describeThisDevice().name !== 'iPad',
    });
  }, [currentSong, isPlaying, volume]);

  // Something the others care about changed (song, play/pause, volume): report shortly after.
  useEffect(() => {
    if (!connected) return;
    const timeoutId = setTimeout(report, 250);
    return () => clearTimeout(timeoutId);
  }, [connected, report]);

  // Otherwise a heartbeat, plus a check for a seek on this device (the playhead jumping away from
  // where the last report said it would be).
  useEffect(() => {
    if (!connected) return;
    const intervalId = setInterval(() => {
      const last = lastSent.current;
      if (!last) return report();
      const expected = last.isPlaying ? last.positionSec + (Date.now() - last.at) / 1000 : last.positionSec;
      if (Math.abs(audioEngine.getCurrentTime() - expected) > DRIFT_TOLERANCE_SEC || Date.now() - last.at > HEARTBEAT_MS) report();
    }, DRIFT_CHECK_MS);
    return () => clearInterval(intervalId);
  }, [connected, report]);

  return null;
}
