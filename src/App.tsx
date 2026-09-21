import { useEffect, useRef } from 'react';
import { initAuth, useAuthStore } from './auth/authStore';
import { AppShell } from './app-shell/AppShell';
import { useToast } from './components/Toast/ToastProvider';
import { useThemeSync } from './hooks/useThemeSync';
import { initServiceWorker } from './pwa/registerSW';
import { initLibrarySync } from './sync/librarySync';
import { initProfileSync } from './sync/profileSync';
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
      initProfileSync();
    }
  }, [status, mustChangePassword]);

  useEffect(() => {
    // Share-link entry point: ?jam=<roomId> opens the Jam join prompt. The param is stripped after reading so a
    // later refresh doesn't re-trigger it (and after signing in, the prompt is waiting behind the landing page).
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get('jam');
    if (roomId) {
      useUiStore.getState().openJoinJamSheet(roomId);
      params.delete('jam');
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
