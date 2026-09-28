import { useMemo, useState, type ReactNode } from 'react';
import { encode } from 'uqr';
import { Icon, type IconName } from '../../components/Icon/Icon';
import { detectDevice, inAppName, isRunningInstalled, type DetectedDevice, type InstallPlatform } from '../../pwa/detectPlatform';
import { promptInstall as askInstall } from '../../pwa/installPrompt';
import { useInstallPrompt } from '../../pwa/useInstallPrompt';
import styles from './InstallPage.module.css';

const TABS: { platform: InstallPlatform; label: string }[] = [
  { platform: 'ios', label: 'iPhone / iPad' },
  { platform: 'android', label: 'Android' },
  { platform: 'desktop', label: 'Komputer' },
];

type Step = { icon?: IconName; text: ReactNode };

/**
 * Public (no sign-in) install guide at /install: detects the device and browser, offers the
 * browser's own install dialog where one exists (Chromium on Android and desktop), and walks through
 * the manual steps everywhere else — iOS has no install API at all. Links opened inside WhatsApp,
 * Instagram and the like land in those apps' built-in browsers, which can't install anything, so
 * that case comes first with the way out.
 */
export default function InstallPage() {
  const device = useMemo(() => detectDevice(), []);
  const [tab, setTab] = useState<InstallPlatform>(device.platform);
  const { canInstall } = useInstallPrompt();
  const [justInstalled, setJustInstalled] = useState(false);
  const installed = isRunningInstalled() || justInstalled;
  const installUrl = `${window.location.origin}/install`;

  const install = async () => {
    if ((await askInstall()) === 'accepted') setJustInstalled(true);
  };

  return (
    <div className={styles.page}>
      <div className={styles.column}>
        <header className={styles.header}>
          <img src="/icons/icon-192.png" alt="" className={styles.appIcon} />
          <h1 className={styles.title}>Pasang Suwwara</h1>
          <p className={styles.lead}>Buka langsung dari layar utama, layar penuh tanpa bar browser, dan lebih cepat.</p>
          <span className={styles.detected}>Terdeteksi: {device.label}</span>
        </header>

        {installed ? (
          <section className={styles.card}>
            <p className={styles.cardTitle}>Suwwara sudah terpasang</p>
            <p className={styles.muted}>Buka dari layar utama atau daftar aplikasimu.</p>
            <a className={styles.primaryButton} href="/">
              Buka Suwwara
            </a>
          </section>
        ) : (
          <>
            {device.inApp && tab === device.platform && <InAppNotice device={device} installUrl={installUrl} />}

            <div className={styles.tabs} role="tablist" aria-label="Pilih perangkat">
              {TABS.map((item) => (
                <button
                  key={item.platform}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.platform}
                  className={[styles.tab, tab === item.platform ? styles.tabActive : ''].join(' ')}
                  onClick={() => setTab(item.platform)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {tab === 'ios' && <IosGuide device={device} />}
            {tab === 'android' && <AndroidGuide device={device} canInstall={canInstall && !device.inApp} onInstall={install} />}
            {tab === 'desktop' && <DesktopGuide device={device} canInstall={canInstall} onInstall={install} installUrl={installUrl} />}
          </>
        )}

        <a className={styles.continueLink} href="/">
          Lanjut ke Suwwara di browser
        </a>
      </div>
    </div>
  );
}

function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol className={styles.steps}>
      {steps.map((step, index) => (
        <li key={index} className={styles.step}>
          <span className={styles.stepNumber}>{index + 1}</span>
          <span className={styles.stepText}>
            {step.text}
            {step.icon && (
              <span className={styles.stepIcon} aria-hidden="true">
                <Icon name={step.icon} size={18} />
              </span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

function InAppNotice({ device, installUrl }: { device: DetectedDevice; installUrl: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(installUrl);
      setCopied(true);
    } catch {
      window.prompt('Salin tautan ini:', installUrl);
    }
  };
  // Android can hand the page straight to Chrome; iOS in-app browsers only offer it from their own menu.
  const chromeIntent = `intent://${window.location.host}/install#Intent;scheme=https;package=com.android.chrome;end`;
  const app = device.inApp ? inAppName(device.inApp) : 'aplikasi ini';

  return (
    <section className={[styles.card, styles.warningCard].join(' ')}>
      <p className={styles.cardTitle}>Buka di {device.platform === 'ios' ? 'Safari' : 'Chrome'} dulu</p>
      <p className={styles.muted}>
        Halaman ini terbuka di browser bawaan {app}, yang tidak bisa memasang aplikasi.
        {device.platform === 'ios'
          ? ' Ketuk ikon ⋯ atau kompas di pojok layar, lalu pilih "Buka di Safari".'
          : ' Ketuk tombol di bawah, atau buka menu ⋮ lalu pilih "Buka di Chrome".'}
      </p>
      <div className={styles.buttonRow}>
        {device.platform === 'android' && (
          <a className={styles.primaryButton} href={chromeIntent}>
            Buka di Chrome
          </a>
        )}
        <button type="button" className={styles.secondaryButton} onClick={copy}>
          {copied ? 'Tautan disalin' : 'Salin tautan'}
        </button>
      </div>
    </section>
  );
}

function IosGuide({ device }: { device: DetectedDevice }) {
  const isIPad = device.label.startsWith('iPad');
  const safari: Step[] = [
    { text: <>Ketuk tombol <b>Bagikan</b> {isIPad ? 'di kanan atas' : 'di bar bawah Safari'}</>, icon: 'share' },
    {
      text: (
        <>
          Gulir ke bawah dan pilih <b>Tambah ke Layar Utama</b>. Tidak terlihat? Ketuk <b>Lainnya</b> (⋯) dulu
        </>
      ),
      icon: 'plus',
    },
    { text: <>Pastikan <b>Buka sebagai App Web</b> menyala, lalu ketuk <b>Tambah</b> di kanan atas</> },
  ];
  const otherBrowser: Step[] = [
    {
      text:
        device.browser === 'chrome' ? (
          <>Ketuk tombol <b>Bagikan</b> di address bar (kanan atas)</>
        ) : (
          <>Buka menu browser, lalu pilih <b>Bagikan</b></>
        ),
      icon: 'share',
    },
    { text: <>Pilih <b>Tambah ke Layar Utama</b></>, icon: 'plus' },
    { text: <>Ketuk <b>Tambah</b></> },
  ];
  const showOther = device.platform === 'ios' && device.browser !== 'safari' && !device.inApp;

  return (
    <section className={styles.card}>
      <p className={styles.cardTitle}>{showOther ? `Pasang dari ${device.label.split(' · ')[1]}` : 'Pasang dari Safari'}</p>
      <Steps steps={showOther ? otherBrowser : safari} />
      <p className={styles.note}>
        {showOther
          ? 'Tidak ada "Tambah ke Layar Utama"? iOS versi lama hanya bisa memasang dari Safari — buka halaman ini di Safari.'
          : 'iPhone tidak punya tombol install otomatis untuk aplikasi web, jadi pemasangannya lewat menu Bagikan.'}
      </p>
    </section>
  );
}

function AndroidGuide({ device, canInstall, onInstall }: { device: DetectedDevice; canInstall: boolean; onInstall: () => void }) {
  const steps: Step[] =
    device.browser === 'samsung'
      ? [
          { text: <>Ketuk menu <b>≡</b> di bar bawah</> },
          { text: <>Pilih <b>Tambahkan halaman ke</b>, lalu <b>Layar utama</b></>, icon: 'plus' },
          { text: <>Ketuk <b>Tambah</b></> },
        ]
      : device.browser === 'firefox'
        ? [
            { text: <>Ketuk menu <b>⋮</b></>, icon: 'more' },
            { text: <>Pilih <b>Instal</b> (atau <b>Tambahkan ke layar utama</b>)</>, icon: 'download' },
            { text: <>Konfirmasi dengan <b>Tambah</b></> },
          ]
        : [
            { text: <>Ketuk menu <b>⋮</b> di kanan atas</>, icon: 'more' },
            { text: <>Pilih <b>Instal aplikasi</b> (atau <b>Tambahkan ke layar utama</b>)</>, icon: 'download' },
            { text: <>Ketuk <b>Instal</b></> },
          ];

  return (
    <section className={styles.card}>
      {canInstall ? (
        <>
          <p className={styles.cardTitle}>Siap dipasang</p>
          <p className={styles.muted}>Satu ketukan, lalu Suwwara ada di layar utama dan daftar aplikasimu.</p>
          <button type="button" className={styles.primaryButton} onClick={onInstall}>
            <Icon name="download" size={18} />
            Pasang Suwwara
          </button>
          <p className={styles.dividerLabel}>atau lewat menu browser</p>
        </>
      ) : (
        <p className={styles.cardTitle}>Pasang lewat menu browser</p>
      )}
      <Steps steps={steps} />
    </section>
  );
}

function DesktopGuide({
  device,
  canInstall,
  onInstall,
  installUrl,
}: {
  device: DetectedDevice;
  canInstall: boolean;
  onInstall: () => void;
  installUrl: string;
}) {
  const manual: Record<string, { title: string; steps: Step[] }> = {
    chrome: {
      title: 'Pasang dari Chrome',
      steps: [
        { text: <>Klik ikon <b>Instal</b> di ujung kanan address bar</>, icon: 'download' },
        { text: <>Atau buka menu <b>⋮</b> → <b>Transmisikan, simpan, dan bagikan</b> → <b>Instal halaman sebagai aplikasi</b></>, icon: 'more' },
        { text: <>Klik <b>Instal</b>. Setelah terpasang, Chrome menampilkan tombol <b>Buka di aplikasi</b> di address bar</> },
      ],
    },
    edge: {
      title: 'Pasang dari Edge',
      steps: [
        { text: <>Buka menu <b>⋯</b> di kanan atas</>, icon: 'more' },
        { text: <>Pilih <b>Aplikasi</b> → <b>Instal situs ini sebagai aplikasi</b></>, icon: 'download' },
        { text: <>Klik <b>Instal</b></> },
      ],
    },
    safari: {
      title: 'Pasang dari Safari (macOS Sonoma ke atas)',
      steps: [
        { text: <>Buka menu <b>File</b> di bar atas</> },
        { text: <>Pilih <b>Tambahkan ke Dock</b></>, icon: 'plus' },
        { text: <>Klik <b>Tambah</b></> },
      ],
    },
  };
  const guide = manual[device.browser === 'opera' ? 'chrome' : device.browser];

  return (
    <>
      <section className={styles.card}>
        {canInstall ? (
          <>
            <p className={styles.cardTitle}>Siap dipasang di komputer ini</p>
            <p className={styles.muted}>Suwwara jadi aplikasi sendiri: jendela terpisah, ada di Dock/taskbar.</p>
            <button type="button" className={styles.primaryButton} onClick={onInstall}>
              <Icon name="download" size={18} />
              Pasang Suwwara
            </button>
          </>
        ) : guide ? (
          <>
            <p className={styles.cardTitle}>{guide.title}</p>
            <Steps steps={guide.steps} />
          </>
        ) : (
          <>
            <p className={styles.cardTitle}>Buka di Chrome atau Edge</p>
            <p className={styles.muted}>
              {device.browser === 'firefox' ? 'Firefox' : 'Browser ini'} belum bisa memasang aplikasi web. Buka halaman ini di Chrome atau Edge
              untuk memasang Suwwara.
            </p>
          </>
        )}
      </section>
      <section className={[styles.card, styles.qrCard].join(' ')}>
        <QrCode value={installUrl} />
        <div>
          <p className={styles.cardTitle}>Pasang di HP</p>
          <p className={styles.muted}>Scan QR ini dengan kamera HP untuk membuka halaman ini di sana.</p>
        </div>
      </section>
    </>
  );
}

// Drawn from uqr's module matrix as one SVG path — no canvas, no innerHTML, no network.
function QrCode({ value }: { value: string }) {
  const { size: box, data } = useMemo(() => encode(value, { ecc: 'M', border: 2 }), [value]);
  const path = data.flatMap((row, y) => row.map((on, x) => (on ? `M${x} ${y}h1v1h-1z` : ''))).join('');
  return (
    <svg className={styles.qr} viewBox={`0 0 ${box} ${box}`} shapeRendering="crispEdges" role="img" aria-label={`QR code ke ${value}`}>
      <rect width={box} height={box} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
