import { describe, expect, it } from 'vitest';
import { usesPlainMediaElements } from '../../src/audio-engine/platform';

const UA = {
  androidPhone: 'Mozilla/5.0 (Linux; Android 14; SM-A155F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  androidTablet: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  // What Chrome on an Android tablet sends by default ("desktop site").
  androidTabletDesktopMode: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  iPhone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  chromebook: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
};

describe('usesPlainMediaElements', () => {
  it('plays straight through <audio> on Android phones and tablets', () => {
    expect(usesPlainMediaElements(UA.androidPhone, 'Linux armv8l', 5)).toBe(true);
    expect(usesPlainMediaElements(UA.androidTablet, 'Linux armv8l', 10)).toBe(true);
  });

  it('recognises an Android tablet in Chrome\'s default desktop-site mode', () => {
    expect(usesPlainMediaElements(UA.androidTabletDesktopMode, 'Linux x86_64', 10)).toBe(true);
  });

  it('keeps iOS (iPhone, and an iPad posing as a Mac) on plain elements', () => {
    expect(usesPlainMediaElements(UA.iPhone, 'iPhone', 5)).toBe(true);
    expect(usesPlainMediaElements(UA.mac, 'MacIntel', 5)).toBe(true);
  });

  it('keeps desktops (and Chromebooks) on Web Audio, where the crossfade lives', () => {
    expect(usesPlainMediaElements(UA.mac, 'MacIntel', 0)).toBe(false);
    expect(usesPlainMediaElements(UA.windows, 'Win32', 0)).toBe(false);
    expect(usesPlainMediaElements(UA.windows, 'Win32', 10)).toBe(false);
    expect(usesPlainMediaElements(UA.androidTabletDesktopMode, 'Linux x86_64', 0)).toBe(false);
    expect(usesPlainMediaElements(UA.chromebook, 'Linux x86_64', 10)).toBe(false);
  });
});
