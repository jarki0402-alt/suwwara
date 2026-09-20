// These import backend code (server/src), which the frontend Docker build context does
// not contain (see .dockerignore), so tests/server is excluded from `tsc -b`
// (tsconfig.vitest.json) and only run by Vitest. Type-check them ad hoc with:
//   npx tsc --noEmit --strict --module esnext --moduleResolution bundler --target es2022 \
//     --skipLibCheck --types node,vitest/globals tests/server/*.test.ts
import { describe, expect, it } from 'vitest';
import { PriorityLimiter, ResolveAbortedError } from '../../server/src/youtube/priorityLimiter';

// A task whose completion the test controls, so ordering can be asserted without timers.
function controllable<T>(value: T) {
  let finish!: () => void;
  const started: string[] = [];
  const fn = (label: string) => () => {
    started.push(label);
    return new Promise<T>((resolve) => {
      finish = () => resolve(value);
    });
  };
  return { fn, finish: () => finish(), started };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('PriorityLimiter', () => {
  it('never runs more than maxConcurrency tasks at once', async () => {
    const limiter = new PriorityLimiter(1);
    const order: string[] = [];
    const gates: Array<() => void> = [];
    const make = (label: string) => () =>
      new Promise<void>((resolve) => {
        order.push(`start:${label}`);
        gates.push(() => {
          order.push(`end:${label}`);
          resolve();
        });
      });

    const a = limiter.schedule('high', make('a')).promise;
    const b = limiter.schedule('high', make('b')).promise;
    await tick();
    expect(order).toEqual(['start:a']);
    gates[0]();
    await a;
    await tick();
    expect(order).toEqual(['start:a', 'end:a', 'start:b']);
    gates[1]();
    await b;
  });

  it('drains the high lane before the low lane, whatever the arrival order', async () => {
    const limiter = new PriorityLimiter(1);
    const started: string[] = [];
    const release: Array<() => void> = [];
    const make = (label: string) => () =>
      new Promise<void>((resolve) => {
        started.push(label);
        release.push(resolve);
      });

    limiter.schedule('high', make('running')); // takes the only slot
    const low = limiter.schedule('low', make('low'));
    const high = limiter.schedule('high', make('high'));
    await tick();
    release.shift()!(); // finish "running"
    await tick();
    expect(started).toEqual(['running', 'high']);
    release.shift()!();
    await high.promise;
    await tick();
    expect(started).toEqual(['running', 'high', 'low']);
    release.shift()!();
    await low.promise;
  });

  it('drops a queued task when it is cancelled, and never starts it', async () => {
    const limiter = new PriorityLimiter(1);
    const first = controllable('first');
    let secondStarted = false;

    limiter.schedule('high', first.fn('first'));
    const second = limiter.schedule('high', async () => {
      secondStarted = true;
      return 'second';
    });
    await tick();

    expect(second.handle.started).toBe(false);
    expect(second.handle.cancel()).toBe(true);
    await expect(second.promise).rejects.toBeInstanceOf(ResolveAbortedError);

    first.finish();
    await tick();
    expect(secondStarted).toBe(false);
    expect(limiter.pendingCount).toBe(0);
  });

  it('cannot cancel a task that already started', async () => {
    const limiter = new PriorityLimiter(1);
    const running = controllable('done');
    const task = limiter.schedule('high', running.fn('running'));
    await tick();
    expect(task.handle.started).toBe(true);
    expect(task.handle.cancel()).toBe(false);
    running.finish();
    await expect(task.promise).resolves.toBe('done');
  });

  it('promotes a queued low task ahead of other low tasks when a high caller shows up', async () => {
    const limiter = new PriorityLimiter(1);
    const started: string[] = [];
    const release: Array<() => void> = [];
    const make = (label: string) => () =>
      new Promise<void>((resolve) => {
        started.push(label);
        release.push(resolve);
      });

    limiter.schedule('high', make('running'));
    limiter.schedule('low', make('lowA'));
    const lowB = limiter.schedule('low', make('lowB'));
    await tick();

    lowB.handle.promote(); // the user just tapped lowB's track
    release.shift()!();
    await tick();
    expect(started).toEqual(['running', 'lowB']);
  });

  it('keeps working after a task throws', async () => {
    const limiter = new PriorityLimiter(1);
    const bad = limiter.schedule('high', () => Promise.reject(new Error('yt-dlp exploded')));
    await expect(bad.promise).rejects.toThrow('yt-dlp exploded');
    const good = limiter.schedule('high', async () => 'fine');
    await expect(good.promise).resolves.toBe('fine');
    expect(limiter.activeCount).toBe(0);
  });
});
