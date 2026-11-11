import { formatBytes } from '../../utils/formatBytes';
import type { ByKind, Pricing, UsageKind } from './adminApi';

/** Labels, units and day arithmetic shared by the usage charts and pages (UsageCharts.tsx, UsageViews.tsx). */

export const KINDS: Array<{ id: UsageKind; label: string; color: string }> = [
  { id: 'song', label: 'Lagu', color: 'var(--viz-song)' },
  { id: 'podcast', label: 'Podcast', color: 'var(--viz-podcast)' },
  { id: 'video', label: 'Video musik', color: 'var(--viz-video)' },
];

export const WEEKDAYS = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min'];

/** "3 j 20 m", "45 m", "30 dtk": listening time. */
export function formatListen(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} dtk`;
  // Rounded to whole minutes first, so 1 h 59.7 m reads "2 j", never "1 j 60 m".
  const total = Math.round(seconds / 60);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes} m`;
  return minutes === 0 ? `${hours} j` : `${hours} j ${minutes} m`;
}

export const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

/** YYYY-MM-DD of a date in this browser's own timezone (the server groups days in the same one). */
export function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function dayName(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });
}

export type Metric = 'bytes' | 'listenSec';
export const formatMetric = (metric: Metric) => (metric === 'bytes' ? formatBytes : formatListen);

export interface StackPoint {
  /** Under the axis, e.g. "11-05" or "21". */
  x: string;
  /** In the tooltip, e.g. "Sel 5 Nov". */
  detail: string;
  values: Record<UsageKind, number>;
}

/** Every day from `days - 1` days ago to today, the missing ones as zero (a gap still reads as a day). */
export function dailyPoints(series: Array<{ day: string } & ByKind>, days: number, metric: Metric, from?: Date): StackPoint[] {
  const byDay = new Map(series.map((row) => [row.day, row]));
  const start = from ? new Date(from) : new Date();
  start.setHours(0, 0, 0, 0);
  if (!from) start.setDate(start.getDate() - (days - 1));
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const key = localDay(date);
    const row = byDay.get(key);
    return {
      x: key.slice(5),
      detail: dayName(key),
      values: { song: row?.song[metric] ?? 0, podcast: row?.podcast[metric] ?? 0, video: row?.video[metric] ?? 0 },
    };
  });
}

const TIME_STEPS = [60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 18000, 36000, 72000, 144000, 360000, 720000];

/** A round gridline step for an axis whose top is `max`: whole minutes/hours for time, 1/2/5 × 10ⁿ for anything else. */
export function niceStep(max: number, metric: Metric, lines = 4): number {
  const raw = Math.max(max, 1) / lines;
  if (metric === 'listenSec') return TIME_STEPS.find((step) => step >= raw) ?? Math.ceil(raw / 720000) * 720000;
  const power = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 2.5, 5, 10].find((factor) => factor * power >= raw) ?? 10) * power;
}

/**
 * Keeps a label or tooltip anchored at `percent` of the plot inside it: flush left/right near the edges, centred
 * elsewhere. Axis dates pass clampStart=false: the value column is to their left, so the first one may overhang it, and
 * pushed right it would run into the second.
 */
export function edgeTransform(percent: number, margin = 12, clampStart = true): string {
  return clampStart && percent < margin ? 'translateX(0)' : percent > 100 - margin ? 'translateX(-100%)' : 'translateX(-50%)';
}

/** "Rp 26.500": whole rupiah, Indonesian grouping. */
export const formatRupiah = (value: number) => `Rp ${Math.round(value).toLocaleString('id-ID')}`;

/** Bytes the server sent, as rupiah on the Google Cloud bill (the same formula as server/src/metrics/billing.ts). */
export const costOf = (bytes: number, pricing: Pricing) => (bytes / 1024 ** 3) * pricing.overhead * pricing.rpPerGib;
