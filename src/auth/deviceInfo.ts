import { t } from '../i18n/i18n';

export interface DeviceInfo {
  name: string;
  kind: 'phone' | 'tablet' | 'desktop';
}

/**
 * A human name for this device, derived from what the browser reveals — shown in Settings -> Perangkat. In the language
 * active when it is asked (the name is stored with the device, so it stays in that language for the other devices).
 */
export function describeThisDevice(): DeviceInfo {
  const ua = navigator.userAgent;
  const isIPad = /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (/iPhone|iPod/.test(ua)) return { name: 'iPhone', kind: 'phone' };
  if (isIPad) return { name: 'iPad', kind: 'tablet' };
  if (/Android/.test(ua)) return { name: /Mobile/.test(ua) ? 'Android' : t('Tablet Android'), kind: /Mobile/.test(ua) ? 'phone' : 'tablet' };

  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : t('Komputer');
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return { name: browser ? `${os} (${browser})` : os, kind: 'desktop' };
}
