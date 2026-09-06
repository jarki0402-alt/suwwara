export function scheduleFadeOut(gainNode: GainNode, context: AudioContext, durationSec: number): void {
  const now = context.currentTime;
  gainNode.gain.cancelScheduledValues(now);
  gainNode.gain.setValueAtTime(gainNode.gain.value, now);
  gainNode.gain.linearRampToValueAtTime(0, now + Math.max(durationSec, 0.01));
}

export function scheduleFadeIn(gainNode: GainNode, context: AudioContext, targetVolume: number, durationSec: number): void {
  const now = context.currentTime;
  gainNode.gain.cancelScheduledValues(now);
  gainNode.gain.setValueAtTime(0, now);
  gainNode.gain.linearRampToValueAtTime(targetVolume, now + Math.max(durationSec, 0.01));
}

export function setGainImmediate(gainNode: GainNode, context: AudioContext, volume: number): void {
  const now = context.currentTime;
  gainNode.gain.cancelScheduledValues(now);
  gainNode.gain.setValueAtTime(volume, now);
}
