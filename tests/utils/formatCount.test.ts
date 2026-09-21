import { describe, expect, it } from 'vitest';
import { formatAddedDate, formatCount } from '../../src/utils/formatCount';

describe('formatCount', () => {
  it('writes every digit with Indonesian grouping', () => {
    expect(formatCount(17_100_000)).toBe('17.100.000');
    expect(formatCount(488_574_530)).toBe('488.574.530');
    expect(formatCount(523)).toBe('523');
  });
});

describe('formatAddedDate', () => {
  it('shows day, month and year only', () => {
    // Noon UTC so the local date is the same in every timezone the tests may run in.
    expect(formatAddedDate(Date.UTC(2026, 7, 10, 12))).toMatch(/^10 Agu(s)? 2026$/);
  });
});
