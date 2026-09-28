import { useSyncExternalStore } from 'react';
import { isRunningInstalled, isIosDevice } from './detectPlatform';
import { getInstallState, promptInstall, subscribeInstall } from './installPrompt';

export function useInstallPrompt() {
  const { deferred, installed } = useSyncExternalStore(subscribeInstall, getInstallState);

  return {
    canInstall: deferred !== null,
    isInstalled: installed || isRunningInstalled(),
    isIOS: isIosDevice(),
    promptInstall: async (): Promise<void> => {
      await promptInstall();
    },
  };
}
