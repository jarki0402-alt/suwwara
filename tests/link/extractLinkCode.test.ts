import { describe, expect, it } from 'vitest';
import { extractLinkCode } from '../../src/components/ScanLinkSheet/qrScanner';

describe('extractLinkCode', () => {
  it('reads the code out of the link a QR encodes', () => {
    expect(extractLinkCode('https://suwwara.example.com/?link=460f20a9')).toBe('460F20A9');
    expect(extractLinkCode('http://localhost:8080/?jam=ABC&link=460F20A9')).toBe('460F20A9');
  });

  it('accepts a bare code, with surrounding whitespace', () => {
    expect(extractLinkCode(' 460f20a9 ')).toBe('460F20A9');
  });

  it('rejects anything that is not exactly an 8-character code', () => {
    expect(extractLinkCode('https://example.com/?link=123')).toBeNull();
    expect(extractLinkCode('https://example.com/?pair=460F20A9')).toBeNull();
    expect(extractLinkCode('460F20A9Z')).toBeNull();
    expect(extractLinkCode('')).toBeNull();
  });
});
