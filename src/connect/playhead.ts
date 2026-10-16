import { audioEngine } from '../audio-engine/AudioEngine';
import { followedDevice, projectedPosition } from './connectStore';

/**
 * Where the song on screen is right now — this device's own playhead, or, while it is a remote, the other device's
 * (projected from its last report; nothing is polled). Read every frame by the seek bar and the lyrics, so it stays a
 * couple of property reads.
 */
export function playheadSec(): number {
  const device = followedDevice();
  return device ? projectedPosition(device) : audioEngine.getCurrentTime();
}

export function playheadDuration(): number {
  const device = followedDevice();
  return device ? (device.state?.durationSec ?? 0) : audioEngine.getDuration();
}
