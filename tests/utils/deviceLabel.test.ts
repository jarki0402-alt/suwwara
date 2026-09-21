import { describe, expect, it } from 'vitest';
import { deviceLabel, timeAgo } from '../../src/utils/deviceLabel';

describe('deviceLabel', () => {
  it('names browser and system', () => {
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')).toBe('Safari di iPhone');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0')).toBe('Edge di Windows');
    expect(deviceLabel('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36')).toBe('Chrome di Android');
    expect(deviceLabel(null)).toBe('Perangkat tak dikenal');
  });
});

describe('timeAgo', () => {
  const now = Date.UTC(2026, 8, 21, 12);
  it('speaks in minutes, hours and days', () => {
    expect(timeAgo(new Date(now - 20_000).toISOString(), now)).toBe('baru saja');
    expect(timeAgo(new Date(now - 5 * 60_000).toISOString(), now)).toBe('5 menit lalu');
    expect(timeAgo(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe('3 jam lalu');
    expect(timeAgo(new Date(now - 2 * 86_400_000).toISOString(), now)).toBe('2 hari lalu');
  });
});
