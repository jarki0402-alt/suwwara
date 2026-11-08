import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ToastProvider } from './components/Toast/ToastProvider';
import './styles/variables.css';
import './styles/theme.css';
import './styles/global.css';
import { applySavedPaneWidths } from './app-shell/paneWidths';
import { installAutoHideScrollbars } from './utils/autoHideScrollbars';
import { captureInstallPrompt } from './pwa/installPrompt';
import { initLanguage } from './i18n/i18n';

applySavedPaneWidths();
installAutoHideScrollbars();
captureInstallPrompt();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element (#root) not found.');

// Waits only when the device uses English (its dictionary is a separate download); Indonesian renders at once as before.
void initLanguage().then(() => {
  createRoot(rootElement).render(
    <StrictMode>
      <ToastProvider>
        <App />
      </ToastProvider>
    </StrictMode>,
  );
});
