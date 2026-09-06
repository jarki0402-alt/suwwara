type TickerCallback = (timestampMs: number) => void;

// requestAnimationFrame fires at the display's native refresh rate, not a
// fixed 60fps — on a 90/120Hz phone that's up to double the work for no
// perceptible benefit on a slowly-sweeping seek thumb or lyric highlight.
// Capping the shared loop itself means every consumer (seek bar, lyrics
// sync, media session) gets the battery/heat win for free instead of each
// throttling independently.
const MIN_TICK_INTERVAL_MS = 1000 / 30;

/**
 * A single shared requestAnimationFrame loop used by the seek bar and the
 * lyrics sync hook. Consolidating into one rAF chain (instead of separate
 * ones per consumer) avoids redundant getCurrentTime() reads per frame on
 * low-end CPUs.
 *
 * Scheduling is fully stopped (not merely skipped) while the document is
 * hidden — this is the main battery/heat safeguard for background/locked-screen
 * playback: no rAF callbacks fire, so no work happens at all.
 */
class FrameTicker {
  private callbacks = new Set<TickerCallback>();
  private rafId: number | null = null;
  private visibilityBound = false;
  private lastTickMs = 0;

  subscribe(callback: TickerCallback): () => void {
    this.callbacks.add(callback);
    this.bindVisibilityListener();
    this.maybeStart();
    return () => {
      this.callbacks.delete(callback);
      if (this.callbacks.size === 0) this.stop();
    };
  }

  private bindVisibilityListener(): void {
    if (this.visibilityBound || typeof document === 'undefined') return;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.stop();
      } else {
        this.maybeStart();
      }
    });
    this.visibilityBound = true;
  }

  private maybeStart(): void {
    if (this.rafId !== null) return;
    if (this.callbacks.size === 0) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    this.rafId = requestAnimationFrame(this.loop);
  }

  private stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private loop = (timestampMs: number): void => {
    if (timestampMs - this.lastTickMs >= MIN_TICK_INTERVAL_MS) {
      this.lastTickMs = timestampMs;
      this.callbacks.forEach((callback) => callback(timestampMs));
    }
    if (typeof document !== 'undefined' && document.hidden) {
      this.rafId = null;
      return;
    }
    this.rafId = requestAnimationFrame(this.loop);
  };
}

export const frameTicker = new FrameTicker();
