import { registerSW } from 'virtual:pwa-register';

interface ToastAction {
  label: string;
  onClick: () => void;
}

type ShowToastFn = (message: string, options?: { action?: ToastAction }) => void;

export function initServiceWorker(showToast: ShowToastFn): void {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      showToast('Versi baru Suwwara tersedia.', {
        action: { label: 'Muat ulang', onClick: () => void updateSW(true) },
      });
    },
    onOfflineReady() {
      showToast('Suwwara siap digunakan secara offline.');
    },
  });
}
