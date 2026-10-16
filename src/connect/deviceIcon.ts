import type { IconName } from '../components/Icon/Icon';

/** The icon for a device kind as the server reports it (auth/deviceInfo.ts: 'phone' | 'tablet' | 'desktop'). */
export function deviceIcon(kind: string | undefined): IconName {
  if (kind === 'phone') return 'phone';
  if (kind === 'tablet') return 'tablet';
  return 'laptop';
}
