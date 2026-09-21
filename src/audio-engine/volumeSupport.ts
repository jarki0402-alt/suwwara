/**
 * Whether an in-app volume slider can do anything on this device. iOS — Safari and every other iPhone/iPad browser, the
 * installed PWA included — ignores writes to HTMLMediaElement.volume (it always reads 1): the system volume is the only
 * one there, and AudioEngine deliberately has no Web Audio gain on iOS (see its notes on MediaElementAudioSourceNode).
 * A slider there moves but changes nothing, so it is not shown; the side buttons do the job, like in Spotify's iOS app.
 * Tested by behaviour, not by user agent, so an iPad posing as a Mac is covered too.
 */
function elementVolumeIsSettable(): boolean {
  if (typeof document === 'undefined') return true;
  try {
    const probe = document.createElement('audio');
    probe.volume = 0.5;
    return probe.volume === 0.5;
  } catch {
    return false;
  }
}

export const canSetVolume: boolean = elementVolumeIsSettable();
