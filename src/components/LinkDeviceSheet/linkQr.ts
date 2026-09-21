import QRCode from 'qrcode';

/**
 * How the "tautkan perangkat" QR is drawn — chosen for being read off a SCREEN by a phone camera:
 *  - `margin: 4`: the 4-module blank border the QR standard asks for. It used to be 1, and against this app's dark
 *    surface the finder patterns had almost no white around them, which is what decoders lock onto first.
 *  - `errorCorrectionLevel: 'L'`: nothing damages a QR on a screen, so spend the capacity on bigger modules instead
 *    (the short link fits version 3, 29 modules, rather than version 4).
 *  - `scale: 8`: a bitmap with exactly 8 pixels per module, shown at its natural size with `image-rendering:
 *    pixelated`, so no scaling ever blurs a module edge (it used to be a 240px image squeezed into 164px).
 */
export const LINK_QR_OPTIONS = { errorCorrectionLevel: 'L', margin: 4, scale: 8 } as const;

export function makeLinkQr(text: string): Promise<string> {
  return QRCode.toDataURL(text, LINK_QR_OPTIONS);
}
