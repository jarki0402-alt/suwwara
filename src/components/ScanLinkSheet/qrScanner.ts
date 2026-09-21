/**
 * In-app QR scanning. Done inside the app (not with the phone's own camera app) because on an
 * iPhone a link opened from the camera lands in Safari, whose storage is separate from the
 * installed app's — the wrong "device" would get linked.
 */
export interface ScannerHandle {
  stop: () => void;
}

interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
}

const SCAN_INTERVAL_MS = 120; // ~8 frames a second is plenty for a QR held still, and cheap on a phone
// The largest side, in pixels, of the region handed to the pure-JS decoder. jsQR needs roughly 3+ pixels per QR
// module, and a QR shown on a laptop screen and held at arm's length is only a fraction of the camera frame — so
// the more of the sensor's own pixels reach the decoder, the more reliably it reads. The loop waits for each decode
// to finish before scheduling the next, so a slower phone just scans fewer frames a second, never piles up work.
const MAX_DECODE_SIDE = 960;

/**
 * The part of the camera frame the person actually sees in the (square, object-fit: cover) viewfinder: the centre
 * square. Decoding only that, at the sensor's own resolution, gives the QR far more pixels than shrinking the whole
 * 16:9 frame to fit a small width did (the old pipeline: 1280 px -> 640 px, halving every module).
 */
export function decodeRegion(videoWidth: number, videoHeight: number, maxSide = MAX_DECODE_SIDE) {
  const side = Math.min(videoWidth, videoHeight);
  const scale = Math.min(1, maxSide / side);
  return { sx: Math.floor((videoWidth - side) / 2), sy: Math.floor((videoHeight - side) / 2), side, outSide: Math.max(1, Math.round(side * scale)) };
}

/** The 8-hex-char link code, from either the full `?link=` URL a QR encodes or the bare code. */
export function extractLinkCode(text: string): string | null {
  const fromUrl = /[?&]link=([0-9A-Fa-f]{8})\b/.exec(text);
  if (fromUrl) return fromUrl[1].toUpperCase();
  const bare = /^\s*([0-9A-Fa-f]{8})\s*$/.exec(text);
  return bare ? bare[1].toUpperCase() : null;
}

export async function startQrScanner(video: HTMLVideoElement, onText: (text: string) => void): Promise<ScannerHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false,
  });
  video.srcObject = stream;
  video.setAttribute('playsinline', 'true'); // iOS would otherwise try to take the video fullscreen
  await video.play();

  const Detector = (window as unknown as { BarcodeDetector?: new (options: { formats: string[] }) => BarcodeDetectorLike }).BarcodeDetector;
  const detector = Detector ? new Detector({ formats: ['qr_code'] }) : null;
  // Safari has no BarcodeDetector; jsQR is a pure-JS decoder, loaded only when a scan actually starts.
  const jsQR = detector ? null : (await import('jsqr')).default;

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const scanFrame = async (): Promise<string | null> => {
    if (video.readyState < 2 || video.videoWidth === 0) return null;
    if (detector) {
      const found = await detector.detect(video).catch(() => []);
      return found[0]?.rawValue ?? null;
    }
    if (!context || !jsQR) return null;
    const { sx, sy, side, outSide } = decodeRegion(video.videoWidth, video.videoHeight);
    canvas.width = outSide;
    canvas.height = outSide;
    context.drawImage(video, sx, sy, side, side, 0, 0, outSide, outSide);
    const image = context.getImageData(0, 0, outSide, outSide);
    return jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
  };

  const tick = async () => {
    if (stopped) return;
    const text = await scanFrame();
    if (stopped) return;
    if (text) onText(text);
    timer = setTimeout(tick, SCAN_INTERVAL_MS);
  };
  timer = setTimeout(tick, SCAN_INTERVAL_MS);

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    },
  };
}
