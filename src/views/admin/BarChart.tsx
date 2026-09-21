import styles from './AdminView.module.css';
import { formatBytes } from '../../utils/formatBytes';

/** Daily bytes as plain SVG bars — no chart library, so the admin screen adds almost nothing to the bundle. */
export function BarChart({ data }: { data: Array<{ day: string; bytes: number }> }) {
  if (data.length === 0) return <p className={styles.muted}>Belum ada data pemakaian.</p>;
  const width = 600;
  const height = 120;
  const max = Math.max(...data.map((point) => point.bytes), 1);
  const slot = width / data.length;
  return (
    <svg className={styles.chart} viewBox={`0 0 ${width} ${height + 16}`} preserveAspectRatio="none" role="img" aria-label="Pemakaian bandwidth per hari">
      <defs>
        <linearGradient id="adminBarGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-accent)" />
          <stop offset="100%" stopColor="var(--color-accent-2)" />
        </linearGradient>
      </defs>
      {data.map((point, index) => {
        const barHeight = Math.max((point.bytes / max) * height, point.bytes > 0 ? 2 : 0);
        return (
          <rect key={point.day} className={styles.bar} x={index * slot + slot * 0.15} y={height - barHeight} width={slot * 0.7} height={barHeight} rx={2}>
            <title>{`${point.day}: ${formatBytes(point.bytes)}`}</title>
          </rect>
        );
      })}
      <text className={styles.axis} x={0} y={height + 12}>
        {data[0].day.slice(5)}
      </text>
      <text className={styles.axis} x={width} y={height + 12} textAnchor="end">
        {data[data.length - 1].day.slice(5)}
      </text>
    </svg>
  );
}
