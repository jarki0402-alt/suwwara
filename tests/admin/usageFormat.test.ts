import { describe, expect, it } from 'vitest';
import { costOf, formatListen, formatRupiah, niceStep } from '../../src/views/admin/usageFormat';

describe('formatListen', () => {
  it('rounds to whole minutes before splitting into hours, so it never reads "60 m"', () => {
    expect(formatListen(7182)).toBe('2 j');
    expect(formatListen(3600 + 59 * 60 + 50)).toBe('2 j');
    expect(formatListen(5400)).toBe('1 j 30 m');
  });
  it('shows minutes and seconds below an hour', () => {
    expect(formatListen(45)).toBe('45 dtk');
    expect(formatListen(600)).toBe('10 m');
  });
});

describe('niceStep', () => {
  it('steps time axes on round minutes and hours', () => {
    expect(niceStep(25 * 3600, 'listenSec')).toBe(36000);
    expect(niceStep(65 * 60, 'listenSec')).toBe(1800);
    expect(niceStep(90, 'listenSec')).toBe(60);
  });
  it('steps byte axes on 1/2/2.5/5 × 10^n', () => {
    expect(niceStep(4.3e9, 'bytes')).toBe(2e9);
    expect(niceStep(700e6, 'bytes')).toBe(2e8);
  });
});

describe('costOf', () => {
  const pricing = { rpPerGib: 1450, overhead: 1.08 };
  it('reproduces the real October 2026 bill from what the server counted, within 2%', () => {
    // Server counted 3.92 GiB; Google billed Rp 6.068 for the Cloudflare egress that month.
    expect(Math.abs(costOf(3.92 * 1024 ** 3, pricing) - 6068) / 6068).toBeLessThan(0.02);
  });
  it('writes whole rupiah with Indonesian grouping', () => {
    expect(formatRupiah(26_512.4)).toBe('Rp 26.512');
  });
});
