export type ResolvePriority = 'high' | 'low';

/** Thrown to a caller whose request went away (tab closed, the user tapped another
 * song) while its resolve was still waiting in line — see PriorityLimiter. */
export class ResolveAbortedError extends Error {
  constructor() {
    super('Resolve aborted: no caller is waiting for it anymore.');
    this.name = 'ResolveAbortedError';
  }
}

// A concurrency-capped task queue with two priority lanes, built for the single yt-dlp
// slot (see stream.ts for why the cap is 1).
//
// Measured in isolation a resolve takes ~1.6s; the multi-second "loading" people
// actually saw was almost entirely time spent waiting behind other resolves (in
// a 4h sample, ~70% of cache-miss requests arrived while another resolve was
// already running, and those took a median of 10s vs 3.4s when the slot was free).
// So the win here is not making one resolve faster, it is never making the track
// the user just tapped wait for work that nobody needs anymore:
//   - two lanes: 'high' (the track being loaded right now) always drains before
//     'low' (speculative lookahead) — the concurrency cap itself is unchanged;
//   - a task still *waiting in line* is dropped the moment every caller that wanted
//     it is gone (the user tapped something else, closed the tab). Before, every
//     abandoned tap still burned a full resolve slot;
//   - a queued 'low' task gets promoted to 'high' when a real playback request for
//     the same track shows up (tapping a song whose lookahead is already queued).
// It still can't interrupt a resolve that has already started — only queue order.
interface QueuedTask {
  start(): void;
}

export interface TaskHandle {
  readonly started: boolean;
  /** Removes the task from the queue if it hasn't started. Returns whether it did. */
  cancel(): boolean;
  /** Moves a still-queued 'low' task to the 'high' lane. */
  promote(): void;
}

export class PriorityLimiter {
  private active = 0;
  private readonly high: QueuedTask[] = [];
  private readonly low: QueuedTask[] = [];

  private readonly maxConcurrency: number;

  constructor(maxConcurrency: number) {
    this.maxConcurrency = maxConcurrency;
  }

  schedule<T>(priority: ResolvePriority, fn: () => Promise<T>): { promise: Promise<T>; handle: TaskHandle } {
    let started = false;
    let settle!: { resolve: (value: T) => void; reject: (reason: unknown) => void };
    const promise = new Promise<T>((resolve, reject) => {
      settle = { resolve, reject };
    });

    const task: QueuedTask = {
      start: () => {
        started = true;
        this.active += 1;
        fn()
          .then(settle.resolve, settle.reject)
          .finally(() => {
            this.active -= 1;
            this.dequeue();
          });
      },
    };

    (priority === 'high' ? this.high : this.low).push(task);
    this.dequeue();

    const handle: TaskHandle = {
      get started() {
        return started;
      },
      cancel: () => {
        if (started) return false;
        const removed = this.remove(this.high, task) || this.remove(this.low, task);
        if (removed) settle.reject(new ResolveAbortedError());
        return removed;
      },
      promote: () => {
        if (started) return;
        if (this.remove(this.low, task)) this.high.push(task);
      },
    };
    return { promise, handle };
  }

  private remove(lane: QueuedTask[], task: QueuedTask): boolean {
    const index = lane.indexOf(task);
    if (index === -1) return false;
    lane.splice(index, 1);
    return true;
  }

  private dequeue(): void {
    if (this.active >= this.maxConcurrency) return;
    const next = this.high.shift() ?? this.low.shift();
    next?.start();
  }

  get pendingCount(): number {
    return this.high.length + this.low.length;
  }

  get activeCount(): number {
    return this.active;
  }
}

