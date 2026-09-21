import { useEffect, useRef } from 'react';
import { initAuth, useAuthStore } from './auth/authStore';
import { AppShell } from './app-shell/AppShell';
import { useToast } from './components/Toast/ToastProvider';
import { useThemeSync } from './hooks/useThemeSync';
import { initServiceWorker } from './pwa/registerSW';
import { initLibrarySync } from './sync/librarySync';
import { useUiStore } from './stores/uiStore';
import { ChangePasswordScreen } from './views/auth/ChangePasswordScreen';
import { LandingPage } from './views/auth/LandingPage';

function App() {
  const { showToast } = useToast();
  useThemeSync();

  const status = useAuthStore((state) => state.status);
  const mustChangePassword = useAuthStore((state) => state.user?.mustChangePassword ?? false);
  const syncStarted = useRef(false);

  useEffect(() => {
    initServiceWorker(showToast);
    void initAuth();
    // Registers once for the app's lifetime — showToast identity is stable (useCallback in ToastProvider).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Library sync talks to the server, so it only starts once someone is signed in (and only once, even if the session
  // expires and the person signs back in without a reload).
  useEffect(() => {
    if (status === 'signed-in' && !mustChangePassword && !syncStarted.current) {
      syncStarted.current = true;
      initLibrarySync();
    }
  }, [status, mustChangePassword]);

  useEffect(() => {
    // Share-link entry points: ?jam=<roomId> opens the Jam join prompt, ?pair=<code>
    // opens the device-pairing confirm prompt (PairDeviceSheet's QR encodes this same
    // shape). Both params are stripped after reading so a later refresh doesn't
    // re-trigger them.
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get('jam');
    const pairCode = params.get('pair');
    const linkCode = params.get('link');
    if (roomId) useUiStore.getState().openJoinJamSheet(roomId);
    if (pairCode) useUiStore.getState().openIncomingPair(pairCode);
    // A QR from the "link a device" screen, opened as a link (an ordinary camera app, or a pasted link).
    if (linkCode && /^[0-9A-Fa-f]{8}$/.test(linkCode)) useUiStore.getState().openLinkScan(linkCode.toUpperCase());

    if (roomId || pairCode || linkCode) {
      params.delete('jam');
      params.delete('pair');
      params.delete('link');
      const query = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
    }
  }, []);

  // While the server is being asked, show only the page background — no flash of the sign-in form for someone who is signed in.
  if (status === 'checking') return <div style={{ position: 'fixed', inset: 0, background: 'var(--color-bg)' }} />;
  if (status === 'signed-out') return <LandingPage />;
  if (mustChangePassword) return <ChangePasswordScreen />;
  return <AppShell />;
}

export default App;
