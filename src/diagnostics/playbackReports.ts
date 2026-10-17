import { formatReport } from './loadTraces';

/**
 * Sends a short note to the server when playback goes wrong where nobody is watching (the screen off, another app in
 * front), shown in the admin console under Pemutaran. The listeners this happens to are customers, not testers: they
 * can't be asked for logs, so the device reports for itself. See server/src/diagnostics/playbackReports.ts.
 *
 * Fire-and-forget and capped per app session, so a phone stuck retrying in the background costs a handful of tiny
 * requests at most.
 */
const MAX_PER_SESSION = 15;
const MAX_TRACE_CHARS = 1500;
let sent = 0;

export function reportPlayback(event: string, detail: string, withTraces = false): void {
  if (sent >= MAX_PER_SESSION || typeof fetch === 'undefined') return;
  sent += 1;
  const traces = withTraces ? `\n\n${formatReport(__APP_BUILD__).slice(0, MAX_TRACE_CHARS)}` : '';
  void fetch('/api/diagnostics/playback', {
    method: 'POST',
    // The page may be frozen or closed right after (the very moments worth reporting): the request still has to land.
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, device: navigator.userAgent, detail: `${detail} · versi ${__APP_BUILD__}${traces}` }),
  }).catch(() => {});
}
