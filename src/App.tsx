import { useEffect } from 'react';
import { AppShell } from './app-shell/AppShell';
import { useToast } from './components/Toast/ToastProvider';
import { useThemeSync } from './hooks/useThemeSync';
import { initServiceWorker } from './pwa/registerSW';
import { useUiStore } from './stores/uiStore';

function App() {
  const { showToast } = useToast();
  useThemeSync();

  useEffect(() => {
    initServiceWorker(showToast);
    // Registers once for the app's lifetime — showToast identity is stable (useCallback in ToastProvider).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Share-link entry point for Jam: ?jam=<roomId> opens the join prompt once,
    // then the param is stripped so a later refresh doesn't re-trigger it.
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get('jam');
    if (roomId) {
      useUiStore.getState().openJoinJamSheet(roomId);
      params.delete('jam');
      const query = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
    }
  }, []);

  return <AppShell />;
}

export default App;
