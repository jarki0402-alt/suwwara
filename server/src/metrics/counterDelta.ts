/**
 * How far one of the network card's byte counters moved since the last reading (metrics/egress.ts). Kept apart from
 * egress.ts so the tests can reach it without a database.
 */
export interface CounterReading {
  /** The kernel's boot id: changes when the VM reboots and the counters start again from 0. */
  boot: string;
  iface: string;
  value: number;
}

export function counterDelta(previous: CounterReading | null, current: CounterReading): number {
  // Nothing to compare with (first reading ever, or another card): start measuring from here.
  if (!previous || previous.iface !== current.iface) return 0;
  // After a reboot the counter restarted from 0: everything on it was sent since then.
  if (previous.boot !== current.boot) return current.value;
  // Same boot but lower: the card was re-created or the counter wrapped. Count from 0 again rather than going negative.
  return current.value >= previous.value ? current.value - previous.value : current.value;
}
