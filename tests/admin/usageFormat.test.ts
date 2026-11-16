import { describe, expect, it } from 'vitest';
import { formatListen, niceStep, quotaPercent } from '../../src/views/admin/usageFormat';

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

describe('quotaPercent', () => {
  const free = 200 * 1024 ** 3;
  it('keeps one decimal while small, so a quiet month does not read 0%', () => {
    expect(quotaPercent(5 * 1024 ** 3, free)).toBe('2,5%');
    expect(quotaPercent(0, free)).toBe('0%');
  });
  it('drops the decimal from 10% up', () => {
    expect(quotaPercent(25.4 * 1024 ** 3, free)).toBe('13%');
  });
});
