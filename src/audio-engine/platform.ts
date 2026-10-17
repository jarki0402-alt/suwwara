/**
 * Whether this device should play straight through its <audio> elements instead of routing them through a Web Audio
 * graph (MediaElementAudioSourceNode → GainNode).
 *
 * iOS: WebKit's MediaElementAudioSourceNode silences audio at random in the background and breaks on screen lock.
 * Android (phones AND tablets): Chrome suspends the AudioContext once the screen is off or another app is in front,
 * and a resume() without a tap may be refused — the element keeps "playing" into a dead graph. Played straight, the
 * element is an ordinary media player to Chrome, which keeps it (and the next track) going behind the lock screen
 * like any music app. Measured cost: no 0.35s crossfade or pause ramp on these devices (hard cuts, as iOS always had).
 *
 * Android tablets need the extra check: Chrome on a tablet asks for desktop sites by default, so its user agent reads
 * "X11; Linux x86_64" with no "Android" in it. A touch screen on Linux (outside ChromeOS) is that tablet.
 */
export function usesPlainMediaElements(userAgent: string, platform: string, maxTouchPoints: number): boolean {
  const iOS = /iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
  return iOS || isAndroidDevice(userAgent, maxTouchPoints);
}

/** Android phones and tablets, including a tablet's desktop-site user agent (see above). */
export function isAndroidDevice(userAgent: string, maxTouchPoints: number): boolean {
  return /Android/i.test(userAgent) || (maxTouchPoints > 0 && /Linux/i.test(userAgent) && !/CrOS/.test(userAgent));
}

export function isPageHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}
