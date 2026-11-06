import { t } from '../i18n/i18n';

/** "Chrome di Windows" from a user-agent string — enough for a person to recognise which of their devices a session is. */
export function deviceLabel(userAgent: string | null): string {
  const ua = userAgent ?? '';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : null;
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\/|CriOS\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : null;
  if (browser && os) return t('{browser} di {os}', { browser, os });
  return browser ?? os ?? t('Perangkat tak dikenal');
}

/** "baru saja", "5 menit lalu", "3 jam lalu", "2 hari lalu". */
export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 90) return t('baru saja');
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t('{n} menit lalu', { n: minutes });
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('{n} jam lalu', { n: hours });
  return t('{n} hari lalu', { n: Math.round(hours / 24) });
}
