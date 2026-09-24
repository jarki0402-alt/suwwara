/**
 * A small in-memory (+ localStorage) log of how each song load actually went on THIS device:
 * how long from the tap to each stage of the <audio> element's life. Exists because the
 * numbers that matter here ("7-10s to start a song on an iPhone") can't be reproduced on the
 * machine the code is written on — a real phone on a real network is the only place they
 * happen, so the phone itself has to be able to report them (Settings -> Diagnostik).
 *
 * Deliberately standalone: no Zustand, no React, nothing the audio engine depends on — the
 * engine only calls begin()/mark()/finish(), and the Settings panel subscribes.
 */

export type TraceStage = 'loadstart' | 'loadedmetadata' | 'canplay' | 'playing';
export type TraceOutcome = 'playing' | 'timeout' | 'error' | 'superseded' | 'loading';

export interface LoadTrace {
  songId: string;
  title: string;
  quality: 'high' | 'low';
  /** The spare element already held this track (natively preloaded), so no network wait was needed. */
  preloaded: boolean;
  startedAt: number;
  /** ms since the tap for each stage that was reached. */
  stages: Partial<Record<TraceStage, number>>;
  /** How many times the element reported it was starved for data ('waiting'/'stalled') during the load. */
  waits: number;
  outcome: TraceOutcome;
  /** MediaError.code if the element itself failed (1 aborted, 2 network, 3 decode, 4 not supported). */
  mediaErrorCode?: number;
  connection?: string;
}

const STORAGE_KEY = 'suwwara-load-traces';
const MAX_TRACES = 12;
const STAGES: TraceStage[] = ['loadstart', 'loadedmetadata', 'canplay', 'playing'];

let traces: LoadTrace[] = read();
let current: { trace: LoadTrace; element: HTMLMediaElement } | null = null;
const listeners = new Set<() => void>();

function read(): LoadTrace[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as LoadTrace[];
    return Array.isArray(parsed) ? parsed.slice(0, MAX_TRACES) : [];
  } catch {
    return [];
  }
}

function commit(): void {
  traces = [...traces];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(traces));
  } catch {
    // private mode / quota — the in-memory copy still works for this session
  }
  listeners.forEach((listener) => listener());
}

function describeConnection(): string | undefined {
  const connection = (navigator as unknown as { connection?: { effectiveType?: string; rtt?: number; downlink?: number } }).connection;
  if (!connection) return undefined; // Safari doesn't expose the Network Information API
  return [connection.effectiveType, connection.rtt !== undefined ? `rtt ${connection.rtt}ms` : '', connection.downlink !== undefined ? `${connection.downlink}Mbps` : '']
    .filter(Boolean)
    .join(' ');
}

/** Starts a trace for a song about to load into `element`. */
export function beginTrace(song: { id: string; name: string }, quality: 'high' | 'low', element: HTMLMediaElement, preloaded: boolean, startedAt = Date.now()): void {
  // loadTrack() can be entered twice for one tap (crossfadeTo falls back to it) — keep one trace.
  if (current && current.trace.songId === song.id && current.trace.outcome === 'loading' && Date.now() - current.trace.startedAt < 500) {
    current.element = element;
    return;
  }
  if (current && current.trace.outcome === 'loading') current.trace.outcome = 'superseded';

  const trace: LoadTrace = {
    songId: song.id,
    title: song.name,
    quality,
    preloaded,
    startedAt,
    stages: {},
    waits: 0,
    outcome: 'loading',
    connection: describeConnection(),
  };
  current = { trace, element };
  traces = [trace, ...traces].slice(0, MAX_TRACES);
  // A preloaded element already fired its events while it was in the background.
  if (preloaded) {
    for (const stage of STAGES) {
      if (stage === 'playing') continue;
      if (element.readyState >= (stage === 'loadstart' ? 0 : stage === 'loadedmetadata' ? 1 : 3)) trace.stages[stage] = 0;
    }
  }
  commit();
}

/** Called for every media event of every element; only the element being loaded counts. */
export function markTrace(stage: TraceStage | 'waiting' | 'error', element: HTMLMediaElement): void {
  if (!current || current.element !== element || current.trace.outcome !== 'loading') return;
  const { trace } = current;
  if (stage === 'waiting') {
    trace.waits += 1;
    return;
  }
  if (stage === 'error') {
    trace.outcome = 'error';
    trace.mediaErrorCode = element.error?.code;
    commit();
    return;
  }
  if (trace.stages[stage] !== undefined) return;
  trace.stages[stage] = Date.now() - trace.startedAt;
  if (stage === 'playing') trace.outcome = 'playing';
  commit();
}

export function finishTrace(outcome: Exclude<TraceOutcome, 'loading'>, mediaErrorCode?: number): void {
  if (!current || current.trace.outcome !== 'loading') return;
  current.trace.outcome = outcome;
  if (mediaErrorCode !== undefined) current.trace.mediaErrorCode = mediaErrorCode;
  commit();
}

export function getTraces(): LoadTrace[] {
  return traces;
}

export function subscribeTraces(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearTraces(): void {
  traces = [];
  current = null;
  commit();
}

const seconds = (ms: number | undefined): string => (ms === undefined ? '—' : `${(ms / 1000).toFixed(1)}s`);

/** Plain-text report that can be pasted straight into a chat. */
export function formatReport(build: string): string {
  const ua = navigator.userAgent;
  const lines = [`Suwwara ${build}`, ua, `standalone=${(navigator as unknown as { standalone?: boolean }).standalone === true}`, ''];
  for (const trace of traces) {
    const s = trace.stages;
    lines.push(
      `${trace.title.slice(0, 28)} [${trace.quality}${trace.preloaded ? ', preload' : ''}] ` +
        `mulai ${seconds(s.loadstart)} | metadata ${seconds(s.loadedmetadata)} | siap ${seconds(s.canplay)} | bunyi ${seconds(s.playing)} ` +
        `| menunggu ${trace.waits}x | ${trace.outcome}${trace.mediaErrorCode ? ` (media error ${trace.mediaErrorCode})` : ''}` +
        `${trace.connection ? ` | ${trace.connection}` : ''}`,
    );
  }
  return lines.join('\n');
}
