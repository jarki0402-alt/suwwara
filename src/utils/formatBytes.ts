import { intlLocale } from '../i18n/i18n';

/** 1234567 → "1,2 MB" ("1.2 MB" in English). Binary units (1 MB = 1024 KB), as the storage and audio numbers everywhere else in the app. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // Formatter per call, not per module: the language can change while the app runs.
  return `${new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: 1 }).format(value)} ${units[unit]}`;
}
