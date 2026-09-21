import jsQR from 'jsqr';
import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import { LINK_QR_OPTIONS } from '../../src/components/LinkDeviceSheet/linkQr';
import { decodeRegion } from '../../src/components/ScanLinkSheet/qrScanner';

const LINK = 'https://suwwara.fajarrizky.my.id/?link=ABCD1234';

/** Renders the QR the way LINK_QR_OPTIONS lays it out (4-module blank border), `pixelsPerModule` wide per module. */
function render(text: string, pixelsPerModule: number) {
  const qr = QRCode.create(text, { errorCorrectionLevel: LINK_QR_OPTIONS.errorCorrectionLevel });
  const total = qr.modules.size + 2 * LINK_QR_OPTIONS.margin;
  const side = total * pixelsPerModule;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const row = Math.floor(y / pixelsPerModule) - LINK_QR_OPTIONS.margin;
      const col = Math.floor(x / pixelsPerModule) - LINK_QR_OPTIONS.margin;
      if (row >= 0 && col >= 0 && row < qr.modules.size && col < qr.modules.size && qr.modules.get(row, col)) {
        const i = (y * side + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 0;
      }
    }
  }
  return { data, side, modules: qr.modules.size };
}

describe('link QR', () => {
  it('keeps the production link at version 3 (29 modules) so each module stays large', () => {
    expect(render(LINK, 4).modules).toBe(29);
  });

  it('decodes back to the link, even at only 4 pixels per module', () => {
    for (const pixelsPerModule of [4, 5, 8]) {
      const { data, side } = render(LINK, pixelsPerModule);
      expect(jsQR(data, side, side, { inversionAttempts: 'dontInvert' })?.data).toBe(LINK);
    }
  });
});

describe('decodeRegion', () => {
  it('takes the centre square of a landscape frame, at full size when it is small enough', () => {
    expect(decodeRegion(1280, 720)).toEqual({ sx: 280, sy: 0, side: 720, outSide: 720 });
  });

  it('caps the decoded size for a large frame, keeping the square centred', () => {
    expect(decodeRegion(1920, 1080)).toEqual({ sx: 420, sy: 0, side: 1080, outSide: 960 });
  });

  it('also handles a portrait frame', () => {
    expect(decodeRegion(720, 1280)).toEqual({ sx: 0, sy: 280, side: 720, outSide: 720 });
  });
});
