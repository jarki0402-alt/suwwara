import { useEffect, useRef, useState } from 'react';
import { audioEngine } from '../audio-engine/AudioEngine';
import { frameTicker } from '../audio-engine/frameTicker';
import type { LrcLine } from './lrcParser';

const SEEK_JUMP_THRESHOLD_SEC = 1.5;

function findActiveIndex(lines: LrcLine[], currentTime: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= currentTime) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

/**
 * Tracks the active lyric line against playback time via the shared
 * frameTicker. React only re-renders when the computed index actually
 * changes (a handful of times per song) — not on every animation frame.
 */
export function useLyricsSync(lines: LrcLine[]): number {
  const [activeIndex, setActiveIndex] = useState(-1);
  const activeIndexRef = useRef(-1);
  const lastTimeRef = useRef(0);

  useEffect(() => {
    activeIndexRef.current = -1;
    lastTimeRef.current = 0;
    setActiveIndex(-1);
  }, [lines]);

  useEffect(() => {
    if (lines.length === 0) return;

    return frameTicker.subscribe(() => {
      const currentTime = audioEngine.getCurrentTime();
      const previousTime = lastTimeRef.current;
      lastTimeRef.current = currentTime;

      const seeked = Math.abs(currentTime - previousTime) > SEEK_JUMP_THRESHOLD_SEC;
      let index = activeIndexRef.current;

      if (seeked || index === -1) {
        index = findActiveIndex(lines, currentTime);
      } else {
        while (index + 1 < lines.length && lines[index + 1].time <= currentTime) index++;
        while (index > 0 && lines[index].time > currentTime) index--;
      }

      if (index !== activeIndexRef.current) {
        activeIndexRef.current = index;
        setActiveIndex(index);
      }
    });
  }, [lines]);

  return activeIndex;
}
