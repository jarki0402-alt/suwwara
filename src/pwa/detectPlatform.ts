import { msg, t } from '../i18n/i18n';

export type InstallPlatform = 'ios' | 'android' | 'desktop';

export type InstallBrowser =
  | 'safari'
  | 'chrome'
  | 'edge'
  | 'samsung'
  | 'firefox'
  | 'opera'
  | 'other';

/** Apps that open links in their own built-in browser, where no install route exists. */
export type InAppBrowser = 'whatsapp' | 'instagram' | 'facebook' | 'tiktok' | 'telegram' | 'line' | 'twitter' | 'other';

export type DetectedDevice = {
  platform: InstallPlatform;
  browser: InstallBrowser;
  inApp: InAppBrowser | null;
  label: string;
};

interface NavigatorStandalone extends Navigator {
  standalone?: boolean;
}

/** Opened from the home screen / as an installed app rather than in a browser tab. */
export function isRunningInstalled() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    (navigator as NavigatorStandalone).standalone === true
  );
}

// iPadOS 13+ Safari reports itself as desktop Mac Safari; only the touchscreen gives it away.
export function isIosDevice(ua = navigator.userAgent) {
  return /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
}

function detectInApp(ua: string): InAppBrowser | null {
  if (/WhatsApp/i.test(ua)) return 'whatsapp';
  if (/Instagram/i.test(ua)) return 'instagram';
  if (/FBAN|FBAV|FB_IAB|FBIOS/i.test(ua)) return 'facebook';
  if (/musical_ly|TikTok|BytedanceWebview/i.test(ua)) return 'tiktok';
  if (/Telegram/i.test(ua)) return 'telegram';
  if (/\bLine\//i.test(ua)) return 'line';
  if (/Twitter/i.test(ua)) return 'twitter';
  // Android WebView marks itself with "; wv)"; a real Chrome tab never does.
  if (/Android.*; wv\)/i.test(ua)) return 'other';
  return null;
}

function detectBrowser(ua: string, ios: boolean): InstallBrowser {
  if (ios) {
    if (/CriOS/i.test(ua)) return 'chrome';
    if (/EdgiOS/i.test(ua)) return 'edge';
    if (/FxiOS/i.test(ua)) return 'firefox';
    if (/OPiOS|OPT\//i.test(ua)) return 'opera';
    return 'safari';
  }
  if (/SamsungBrowser/i.test(ua)) return 'samsung';
  if (/Edg\//i.test(ua)) return 'edge';
  if (/OPR\/|Opera/i.test(ua)) return 'opera';
  if (/Firefox\//i.test(ua)) return 'firefox';
  if (/Chrome\//i.test(ua)) return 'chrome';
  if (/Safari\//i.test(ua)) return 'safari';
  return 'other';
}

const BROWSER_NAME: Record<InstallBrowser, string> = {
  safari: 'Safari',
  chrome: 'Chrome',
  edge: 'Edge',
  samsung: 'Samsung Internet',
  firefox: 'Firefox',
  opera: 'Opera',
  other: msg('browser ini'),
};

const IN_APP_NAME: Record<InAppBrowser, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  telegram: 'Telegram',
  line: 'LINE',
  twitter: 'X',
  other: msg('aplikasi ini'),
};

/** `label` is in the current language: call again after a language switch (InstallPage memoizes on `t`). */
export function detectDevice(ua = navigator.userAgent): DetectedDevice {
  const ios = isIosDevice(ua);
  const platform: InstallPlatform = ios ? 'ios' : /android/i.test(ua) ? 'android' : 'desktop';
  const browser = detectBrowser(ua, ios);
  const inApp = detectInApp(ua);
  const device = platform === 'ios' ? (/ipad/i.test(ua) || /macintosh/i.test(ua) ? 'iPad' : 'iPhone') : platform === 'android' ? 'Android' : desktopName(ua);
  const via = inApp ? t('browser bawaan {app}', { app: t(IN_APP_NAME[inApp]) }) : t(BROWSER_NAME[browser]);
  return { platform, browser, inApp, label: `${device} · ${via}` };
}

function desktopName(ua: string) {
  if (/Mac OS X|Macintosh/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/CrOS/i.test(ua)) return 'Chromebook';
  if (/Linux/i.test(ua)) return 'Linux';
  return t('Komputer');
}

export const inAppName = (inApp: InAppBrowser) => t(IN_APP_NAME[inApp]);
