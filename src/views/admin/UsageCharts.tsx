import { useState } from 'react';
import { formatBytes } from '../../utils/formatBytes';
import type { Heatmap, UsageKind } from './adminApi';
import styles from './AdminView.module.css';
import { edgeTransform, formatListen, hourLabel, KINDS, niceStep, WEEKDAYS, type Metric, type StackPoint } from './usageFormat';

/**
 * Charts for the usage pages, plain SVG/HTML like TrendChart (the admin bundle stays small, no chart library).
 * Song / podcast / video always wear the same three categorical colours (`--viz-song` etc. in AdminView.module.css,
 * the dataviz skill's first three slots, which pass its colour-blindness checks as a set in light and dark), so a kind
 * is recognisable across every chart; the legend names them, values are always also written out in text.
 */

export function Legend({ kinds, totals, format }: { kinds: UsageKind[]; totals?: Record<UsageKind, number>; format?: (value: number) => string }) {
  return (
    <div className={`${styles.legend} ${styles.viz}`}>
      {KINDS.filter((kind) => kinds.includes(kind.id)).map((kind) => (
        <span key={kind.id} className={styles.legendItem}>
          <span className={styles.swatch} style={{ background: kind.color }} />
          {kind.label}
          {totals && format && <strong>{format(totals[kind.id])}</strong>}
        </span>
      ))}
    </div>
  );
}

/**
 * Bars per day (or hour), each split song / podcast / video. Stacked because the total is the question ("how much
 * that day") and the parts are the follow-up; one axis, one unit per chart (bytes OR time, never both).
 */
export function StackedBars({
  points,
  kinds,
  format,
  metric,
  ariaLabel,
}: {
  points: StackPoint[];
  kinds: UsageKind[];
  format: (value: number) => string;
  metric: Metric;
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = KINDS.filter((kind) => kinds.includes(kind.id));
  const total = (point: StackPoint) => shown.reduce((sum, kind) => sum + point.values[kind.id], 0);
  const max = Math.max(...points.map(total), 0);
  if (points.length === 0) return <p className={styles.muted}>Belum ada data.</p>;

  const width = 720;
  const height = 240;
  const padLeft = 6;
  const padRight = 8;
  const padTop = 12;
  const padBottom = 28;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  // Gridlines on round values (2 j, 30 m, 500 MB), not on fractions of the tallest bar.
  const step = niceStep(max, metric);
  const top = step * Math.max(1, Math.ceil(max / step));
  const lines = Math.round(top / step);
  const yValues = Array.from({ length: lines + 1 }, (_, i) => (i === lines ? '0' : format(top - step * i)));
  const slot = plotW / points.length;
  const barW = Math.max(2, Math.min(28, slot * 0.68));
  const tickEvery = Math.max(1, Math.ceil(points.length / 6));
  const GAP = 2; // surface gap between stacked segments (dataviz: spacers)

  return (
    <div className={`${styles.chartFrame} ${styles.viz}`} style={{ '--y-chars': Math.max(...yValues.map((label) => label.length)) } as React.CSSProperties}>
      <div className={styles.yAxis} aria-hidden="true">
        {yValues.map((label, i) => (
          <span key={i} className={styles.axisYLabel} style={{ top: `${((padTop + (plotH / lines) * i) / height) * 100}%` }}>
            {label}
          </span>
        ))}
      </div>
      <div className={styles.chartWrap} onMouseLeave={() => setHover(null)}>
        <svg className={styles.chart} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={ariaLabel}>
          {Array.from({ length: lines + 1 }, (_, i) => {
            const y = padTop + (plotH / lines) * i;
            return <line key={i} className={styles.gridLine} x1={padLeft} x2={width - padRight} y1={y} y2={y} />;
          })}
          {points.map((point, i) => {
            const x = padLeft + slot * i + (slot - barW) / 2;
            let y = padTop + plotH;
            return (
              <g key={point.x + i} opacity={hover === null || hover === i ? 1 : 0.55}>
                {shown.map((kind) => {
                  const value = point.values[kind.id];
                  if (value <= 0) return null;
                  const h = Math.max(1, (value / top) * plotH);
                  y -= h;
                  const rect = (
                    <rect key={kind.id} x={x} y={y + GAP / 2} width={barW} height={Math.max(1, h - GAP / 2)} rx={Math.min(3, barW / 3)} fill={kind.color} />
                  );
                  return rect;
                })}
              </g>
            );
          })}
          {points.map((_, i) => (
            <rect key={`hit${i}`} x={padLeft + slot * i} y={padTop} width={slot} height={plotH} fill="transparent" onMouseEnter={() => setHover(i)} />
          ))}
        </svg>
        <div className={styles.axisLabels} aria-hidden="true">
          {points.map(
            (point, i) =>
              // The last bar is always labelled; the regular tick before it only when a full step away, or the two touch on a phone.
              (i === points.length - 1 || (i % tickEvery === 0 && points.length - 1 - i >= tickEvery)) && (
                <span
                  key={point.x + i}
                  className={styles.axisXLabel}
                  style={{
                    left: `${((padLeft + slot * i + slot / 2) / width) * 100}%`,
                    transform: edgeTransform(((padLeft + slot * i + slot / 2) / width) * 100, 6, false),
                  }}
                >
                  {point.x}
                </span>
              ),
          )}
        </div>
        {hover !== null && (
          <div
            className={styles.tooltip}
            style={{
              left: `${((padLeft + slot * hover + slot / 2) / width) * 100}%`,
              transform: edgeTransform(((padLeft + slot * hover + slot / 2) / width) * 100, 18),
            }}
          >
            <span>{points[hover].detail}</span>
            {shown.map((kind) => (
              <span key={kind.id} className={styles.tooltipRow}>
                <span className={styles.swatch} style={{ background: kind.color }} />
                {kind.label} <strong>{format(points[hover].values[kind.id])}</strong>
              </span>
            ))}
            {shown.length > 1 && (
              <span>
                Total <strong>{format(total(points[hover]))}</strong>
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * When people listen: weekday × hour, one hue from faint to full (sequential: more = darker), so the busy evenings
 * stand out at a glance. Hovering a cell names it exactly.
 */
export function HourHeatmap({ heatmap, metric = 'listen' }: { heatmap: Heatmap; metric?: 'listen' | 'bytes' }) {
  const [hover, setHover] = useState<{ day: number; hour: number } | null>(null);
  const grid = heatmap[metric];
  const format = metric === 'listen' ? formatListen : formatBytes;
  const max = Math.max(...grid.flat(), 0);
  const byHour = Array.from({ length: 24 }, (_, hour) => grid.reduce((sum, row) => sum + row[hour], 0));
  const byDay = grid.map((row) => row.reduce((sum, value) => sum + value, 0));
  const peakHour = byHour.indexOf(Math.max(...byHour));
  const peakDay = byDay.indexOf(Math.max(...byDay));
  if (max === 0) return <p className={styles.muted}>Belum ada data jam dengar di rentang ini.</p>;

  return (
    <div className={styles.viz}>
      <div
        className={styles.heatmap}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`Aktivitas per hari dan jam. Tersibuk ${WEEKDAYS[peakDay]}, sekitar ${hourLabel(peakHour)}.`}
      >
        <span />
        {Array.from({ length: 24 }, (_, hour) => (
          <span key={hour} className={styles.heatHour}>
            {hour % 3 === 0 ? hour : ''}
          </span>
        ))}
        {grid.map((row, day) => (
          <div key={day} className={styles.heatRow}>
            <span className={styles.heatDay}>{WEEKDAYS[day]}</span>
            {row.map((value, hour) => (
              <span
                key={hour}
                className={styles.heatCell}
                style={
                  {
                    '--heat': value > 0 ? `${Math.round(12 + (value / max) * 88)}%` : '0%',
                  } as React.CSSProperties
                }
                onMouseEnter={() => setHover({ day, hour })}
              />
            ))}
          </div>
        ))}
      </div>
      <div className={styles.heatFoot}>
        <span>
          {hover ? (
            <>
              {WEEKDAYS[hover.day]} {hourLabel(hover.hour)}–{hourLabel((hover.hour + 1) % 24)} · <strong>{format(grid[hover.day][hover.hour])}</strong>
            </>
          ) : (
            <>
              Tersibuk: <strong>{WEEKDAYS[peakDay]}</strong>, sekitar <strong>{hourLabel(peakHour)}</strong>
            </>
          )}
        </span>
        <span className={styles.heatScale}>
          Sedikit <span className={styles.heatRamp} /> Banyak
        </span>
      </div>
    </div>
  );
}

/** One 100% bar: how a total splits over the kinds, with the share written next to each colour. */
export function KindSplit({ values, format }: { values: Record<UsageKind, number>; format: (value: number) => string }) {
  const total = KINDS.reduce((sum, kind) => sum + values[kind.id], 0);
  if (total <= 0) return <p className={styles.muted}>Belum ada data.</p>;
  return (
    <div className={styles.viz}>
      <div className={styles.splitBar}>
        {KINDS.filter((kind) => values[kind.id] > 0).map((kind) => (
          <span
            key={kind.id}
            style={{
              width: `${(values[kind.id] / total) * 100}%`,
              background: kind.color,
            }}
            title={`${kind.label}: ${format(values[kind.id])}`}
          />
        ))}
      </div>
      <div className={styles.legend}>
        {KINDS.filter((kind) => values[kind.id] > 0).map((kind) => (
          <span key={kind.id} className={styles.legendItem}>
            <span className={styles.swatch} style={{ background: kind.color }} />
            {kind.label} <strong>{format(values[kind.id])}</strong>
            <span className={styles.muted}>{Math.round((values[kind.id] / total) * 100)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}
