interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type InstallState = { deferred: BeforeInstallPromptEvent | null; installed: boolean };

let state: InstallState = { deferred: null, installed: false };
const listeners = new Set<() => void>();

function set(next: Partial<InstallState>) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
}

/**
 * Chrome fires `beforeinstallprompt` once, early in the page's life. Anything that starts listening
 * later — the lazily loaded /install page, a settings panel opened a minute in — would never see it,
 * so it's caught here as the app boots and kept for whoever asks.
 */
export function captureInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (event) => {
    // On /install Chrome is left to show its own install banner right away (the page exists to
    // install). Everywhere else it's held back so the app isn't nagged; our buttons still work.
    if (window.location.pathname.replace(/\/+$/, '') !== '/install') event.preventDefault();
    set({ deferred: event as BeforeInstallPromptEvent });
  });
  window.addEventListener('appinstalled', () => set({ deferred: null, installed: true }));
}

export function subscribeInstall(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getInstallState = () => state;

/** Opens the browser's own install dialog. Only works from a tap/click, and only once per event. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = state.deferred;
  if (!event) return 'unavailable';
  await event.prompt();
  const { outcome } = await event.userChoice;
  set({ deferred: null, installed: outcome === 'accepted' || state.installed });
  return outcome;
}
