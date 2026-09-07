import { useEffect } from 'react';
import { AppShell } from './app-shell/AppShell';
import { useToast } from './components/Toast/ToastProvider';
import { useThemeSync } from './hooks/useThemeSync';
import { initServiceWorker } from './pwa/registerSW';
import { initLibrarySync } from './sync/librarySync';
import { useUiStore } from './stores/uiStore';

function App() {
  const { showToast } = useToast();
  useThemeSync();

  useEffect(() => {
    initServiceWorker(showToast);
    initLibrarySync();
    // Registers once for the app's lifetime — showToast identity is stable (useCallback in ToastProvider).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Share-link entry points: ?jam=<roomId> opens the Jam join prompt, ?pair=<code>
    // opens the device-pairing confirm prompt (PairDeviceSheet's QR encodes this same
    // shape). Both params are stripped after reading so a later refresh doesn't
    // re-trigger them.
    const params = new URLSearchParams(window.location.search);
    const roomId = params.get('jam');
    const pairCode = params.get('pair');
    if (roomId) useUiStore.getState().openJoinJamSheet(roomId);
    if (pairCode) useUiStore.getState().openIncomingPair(pairCode);

    if (roomId || pairCode) {
      params.delete('jam');
      params.delete('pair');
      const query = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
    }
  }, []);

  return <AppShell />;
}

export default App;
