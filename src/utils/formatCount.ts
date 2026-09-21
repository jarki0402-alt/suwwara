const countFormat = new Intl.NumberFormat('id-ID');
const dateFormat = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });

/** 17100000 → "17.100.000" — every digit, Indonesian grouping, the way Spotify shows listeners and plays. */
export function formatCount(value: number): string {
  return countFormat.format(value);
}

/** A timestamp as day, month, year only — "10 Agu 2026". */
export function formatAddedDate(timestampMs: number): string {
  return dateFormat.format(new Date(timestampMs));
}
