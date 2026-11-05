/**
 * One place that owns SIGTERM/SIGINT. Several modules keep state in memory that should reach Postgres before the
 * process goes (usage counters, open Jam rooms); each registering its own `process.once(signal, ... process.exit)`
 * meant the first handler to finish killed the process under the others' still-running writes.
 */
const tasks: Array<() => Promise<void>> = [];
// Docker gives 10s between SIGTERM and SIGKILL; leave room for the exit itself.
const SHUTDOWN_DEADLINE_MS = 8000;

export function onShutdown(task: () => Promise<void>): void {
  tasks.push(task);
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    const deadline = new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_DEADLINE_MS).unref());
    void Promise.race([Promise.allSettled(tasks.map((task) => task())), deadline]).finally(() => process.exit(0));
  });
}
