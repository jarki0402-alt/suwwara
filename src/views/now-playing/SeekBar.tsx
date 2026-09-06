import { useEffect, useRef, useState } from 'react';
import { audioEngine } from '../../audio-engine/AudioEngine';
import { frameTicker } from '../../audio-engine/frameTicker';
import { ProgressBar, type ProgressBarHandle } from '../../components/ProgressBar/ProgressBar';
import { sendJamIntent } from '../../jam/jamClient';
import { useJamStore } from '../../stores/jamStore';
import { formatTime } from '../../utils/formatTime';
import styles from './SeekBar.module.css';

/**
 * Reads playback position every frame via the shared frameTicker and pushes
 * it straight into the ProgressBar's imperative handle — the component only
 * re-renders (via displaySeconds) once per whole second, for the time labels.
 */
export function SeekBar({ duration }: { duration: number }) {
  const progressBarRef = useRef<ProgressBarHandle>(null);
  const [displaySeconds, setDisplaySeconds] = useState(0);
  // Mirrors whatever denominator the bar itself is using (audioEngine.getDuration(),
  // falling back to the duration prop) — computed fresh every tick rather than
  // read from the duration prop directly, so the total-time label can never show a
  // different number than what the fill fraction is actually being divided by.
  const [totalSeconds, setTotalSeconds] = useState(duration);
  const lastWholeSecondRef = useRef(-1);
  const lastTotalRef = useRef(duration);

  useEffect(() => {
    lastTotalRef.current = duration;
    setTotalSeconds(duration);
  }, [duration]);

  useEffect(() => {
    return frameTicker.subscribe(() => {
      const currentTime = audioEngine.getCurrentTime();
      const effectiveDuration = audioEngine.getDuration() || duration;
      progressBarRef.current?.setProgress(effectiveDuration > 0 ? Math.min(currentTime / effectiveDuration, 1) : 0);

      if (effectiveDuration !== lastTotalRef.current) {
        lastTotalRef.current = effectiveDuration;
        setTotalSeconds(effectiveDuration);
      }

      // Clamped to effectiveDuration: usePlaybackController reacts to currentTime
      // crossing the real duration within one poll cycle (up to ~2s) and advances to the
      // next track, but this avoids even that brief window showing "current > total".
      const wholeSecond = Math.min(Math.floor(currentTime), Math.floor(effectiveDuration));
      if (wholeSecond !== lastWholeSecondRef.current) {
        lastWholeSecondRef.current = wholeSecond;
        setDisplaySeconds(wholeSecond);
      }
    });
  }, [duration]);

  const handleSeekFraction = (fraction: number) => {
    const effectiveDuration = audioEngine.getDuration() || duration;
    const positionSec = fraction * effectiveDuration;
    const { role, roomId, clientId } = useJamStore.getState();
    if (role !== 'solo' && roomId) {
      void sendJamIntent(roomId, clientId, 'seek', { positionSec });
      return;
    }
    audioEngine.seek(positionSec);
  };

  return (
    <div className={styles.wrapper}>
      <ProgressBar ref={progressBarRef} onSeekFraction={handleSeekFraction} ariaLabel="Posisi lagu" />
      <div className={styles.times}>
        <span>{formatTime(displaySeconds)}</span>
        <span>{formatTime(totalSeconds)}</span>
      </div>
    </div>
  );
}
