import { describe, expect, it } from 'vitest';
import { counterDelta } from '../../server/src/metrics/counterDelta';

describe('counterDelta', () => {
  const at = (value: number, boot = 'a', iface = 'ens4') => ({ boot, iface, value });

  it('counts what moved since the last reading', () => {
    expect(counterDelta(at(1_000), at(4_500))).toBe(3_500);
  });
  it('starts from zero on the first reading, never counting everything since boot as one hour', () => {
    expect(counterDelta(null, at(9e9))).toBe(0);
  });
  it('after a VM reboot takes the whole new counter (it restarted from 0)', () => {
    expect(counterDelta(at(9e9, 'a'), at(2_000, 'b'))).toBe(2_000);
  });
  it('never goes negative when a counter drops within the same boot', () => {
    expect(counterDelta(at(5_000), at(300))).toBe(300);
  });
  it('restarts when the card changes', () => {
    expect(counterDelta(at(5_000, 'a', 'ens4'), at(7_000, 'a', 'eth0'))).toBe(0);
  });
});
