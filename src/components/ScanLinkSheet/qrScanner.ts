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
const MAX_FRAME_WIDTH = 640; // decode a downscaled frame — QR codes survive it, and it is far less work

/** The 8-hex-char link code, from either the full `?link=` URL a QR encodes or the bare code. */
export function extractLinkCode(text: string): string | null {
  const fromUrl = /[?&]link=([0-9A-Fa-f]{8})\b/.exec(text);
  if (fromUrl) return fromUrl[1].toUpperCase();
  const bare = /^\s*([0-9A-Fa-f]{8})\s*$/.exec(text);
  return bare ? bare[1].toUpperCase() : null;
}

export async function startQrScanner(video: HTMLVideoElement, onText: (text: string) => void): Promise<ScannerHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
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
    const scale = Math.min(1, MAX_FRAME_WIDTH / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
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
