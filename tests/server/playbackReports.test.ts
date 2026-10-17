// Imports backend code (server/src) that the frontend Docker build context does not contain —
// see the note in tests/server/priorityLimiter.test.ts.
import { beforeEach, describe, expect, it } from 'vitest';
import { addPlaybackReport, clearPlaybackReports, listPlaybackReports } from '../../server/src/diagnostics/playbackReports';

describe('playback reports', () => {
  beforeEach(() => clearPlaybackReports());

  it('keeps only the newest 200, newest first', () => {
    for (let i = 0; i < 250; i += 1) addPlaybackReport('budi', { event: 'system_pause', device: 'x', detail: `#${i}` });
    const reports = listPlaybackReports();
    expect(reports).toHaveLength(200);
    expect(reports[0].detail).toBe('#249');
    expect(reports[199].detail).toBe('#50');
  });

  it('cuts every field to a fixed length, whatever a client sends', () => {
    addPlaybackReport('budi', { event: 'background_retry', device: 'd'.repeat(10_000), detail: 'x'.repeat(100_000) });
    const [report] = listPlaybackReports();
    expect(report.device.length).toBe(160);
    expect(report.detail.length).toBe(2000);
  });

  it('refuses anything that is not a report', () => {
    expect(addPlaybackReport('budi', null)).toBe(false);
    expect(addPlaybackReport('budi', { event: '<script>' })).toBe(false);
    expect(addPlaybackReport('budi', { detail: 'no event' })).toBe(false);
    expect(listPlaybackReports()).toHaveLength(0);
  });
});
