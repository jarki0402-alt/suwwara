import { useState } from 'react';
import styles from './AdminView.module.css';
import { edgeTransform } from './usageFormat';

export interface TrendPoint {
  /** Short label under the axis (e.g. "09-21", "14:30"). */
  x: string;
  value: number;
  /** Full label shown in the hover tooltip; falls back to `x`. */
  detail?: string;
}

interface TrendChartProps {
  data: TrendPoint[];
  formatValue: (value: number) => string;
  ariaLabel: string;
  /** Compact sparkline: no axes, no gridlines, no tooltip — for a small monitoring strip. */
  mini?: boolean;
}

const GRID_LINES = 4;

/**
 * A single-series area/line trend, plain SVG (no chart library, so the admin console — already lazy-loaded away from the
 * music bundle — stays small). Replaces the old bar chart: bars for a 14/30/90-day range with mostly-empty days read as
 * a few flat blocks with dead space; a continuous line over every day (missing ones filled with 0 by the caller) reads
 * as one shape at a glance. One series, so no legend (dataviz skill: a legend is for identity across >=2 series).
 */
export function TrendChart({ data, formatValue, ariaLabel, mini = false }: TrendChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  if (data.length === 0) return <p className={styles.muted}>Belum ada data.</p>;

  const width = 720;
  const height = mini ? 96 : 260;
  const padLeft = mini ? 2 : 6;
  const padRight = mini ? 2 : 12;
  const padTop = 14;
  const padBottom = mini ? 2 : 30;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const max = Math.max(...data.map((point) => point.value), 1) * 1.15;
  // A single sample (e.g. a monitoring sparkline right after the tab opens) draws as a flat line at that value
  // instead of a moveto-with-nothing-to-draw, which is invisible.
  const pts = data.length === 1 ? [data[0], data[0]] : data;

  const xAt = (i: number) => padLeft + (i / (pts.length - 1)) * plotW;
  const yAt = (value: number) => padTop + plotH - (value / max) * plotH;

  const linePath = pts.map((point, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(point.value)}`).join(' ');
  const areaPath = `${linePath} L ${xAt(pts.length - 1)} ${padTop + plotH} L ${xAt(0)} ${padTop + plotH} Z`;
  const gradientId = mini ? 'trendGradientMini' : 'trendGradientMain';
  const tickEvery = Math.max(1, Math.ceil(pts.length / 6));
  const colWidth = plotW / pts.length;

  const yValues = Array.from({ length: GRID_LINES + 1 }, (_, i) => formatValue(max * (1 - i / GRID_LINES)));
  const yLabels = !mini && (
    <div className={styles.yAxis} aria-hidden="true">
      {yValues.map((label, i) => (
        <span key={i} className={styles.axisYLabel} style={{ top: `${((padTop + (plotH / GRID_LINES) * i) / height) * 100}%` }}>
          {label}
        </span>
      ))}
    </div>
  );

  return (
    <div
      className={mini ? undefined : styles.chartFrame}
      style={mini ? undefined : ({ '--y-chars': Math.max(...yValues.map((label) => label.length)) } as React.CSSProperties)}
    >
      {yLabels}
      <div className={styles.chartWrap} onMouseLeave={() => setHover(null)}>
        <svg className={mini ? styles.chartMini : styles.chart} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={ariaLabel}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.4" />
              <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {!mini &&
            Array.from({ length: GRID_LINES + 1 }, (_, i) => {
              const gy = padTop + (plotH / GRID_LINES) * i;
              return <line key={i} className={styles.gridLine} x1={padLeft} x2={width - padRight} y1={gy} y2={gy} />;
            })}
          <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
          <path d={linePath} fill="none" stroke="var(--color-accent)" strokeWidth={mini ? 1.5 : 2.25} strokeLinecap="round" strokeLinejoin="round" />
          {hover !== null && (
            <>
              <line className={styles.crosshair} x1={xAt(hover)} x2={xAt(hover)} y1={padTop} y2={padTop + plotH} />
              <circle cx={xAt(hover)} cy={yAt(data[hover].value)} r={mini ? 2.5 : 4.5} className={styles.dot} />
            </>
          )}
          {!mini &&
            data.map((point, i) => (
              <rect
                key={point.x + i}
                x={xAt(i) - colWidth / 2}
                y={padTop}
                width={colWidth}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
              />
            ))}
        </svg>
        {/*
         * Axis labels are plain HTML, not SVG <text>, on purpose: the chart above uses preserveAspectRatio="none" so it
         * stretches to fill the card's actual width (never the same as the 720-unit viewBox), and that stretch scales X
         * and Y independently. A <path> or <line> looks fine distorted that way, but SVG <text> glyphs are geometry too —
         * they warp into visibly squashed/stretched letterforms. Percentage position here still lines up exactly with the
         * SVG geometry beneath it (a viewBox-fraction always lands at the same rendered-box-fraction under `none`
         * scaling), so only the *shape* moves to HTML, not the alignment.
         */}
        {!mini && (
          <div className={styles.axisLabels} aria-hidden="true">
            {pts.map(
              (point, i) =>
                // The last point is always labelled; the regular tick before it only when a full step away, or the two touch on a phone.
                (i === pts.length - 1 || (i % tickEvery === 0 && pts.length - 1 - i >= tickEvery)) && (
                  <span
                    key={point.x + i}
                    className={styles.axisXLabel}
                    style={{
                      left: `${(xAt(i) / width) * 100}%`,
                      transform: edgeTransform((xAt(i) / width) * 100, 6, false),
                    }}
                  >
                    {point.x}
                  </span>
                ),
            )}
          </div>
        )}
        {hover !== null && !mini && (
          <div
            className={styles.tooltip}
            style={{
              left: `${(xAt(hover) / width) * 100}%`,
              transform: edgeTransform((xAt(hover) / width) * 100, 18),
            }}
          >
            <strong>{formatValue(data[hover].value)}</strong>
            <span>{data[hover].detail ?? data[hover].x}</span>
          </div>
        )}
      </div>
    </div>
  );
}
