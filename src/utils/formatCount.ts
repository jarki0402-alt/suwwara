import { intlLocale } from '../i18n/i18n';

// Formatters per call, not per module: the language can change while the app runs, and these are cheap to build.

/** 17100000 → "17.100.000" — every digit, grouped the way the current language does, the way Spotify shows listeners and plays. */
export function formatCount(value: number): string {
  return new Intl.NumberFormat(intlLocale()).format(value);
}

/** A timestamp as day, month, year only — "10 Agu 2026". */
export function formatAddedDate(timestampMs: number): string {
  return new Intl.DateTimeFormat(intlLocale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(timestampMs));
}
