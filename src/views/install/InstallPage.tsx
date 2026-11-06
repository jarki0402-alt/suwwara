import { useMemo, useState, type ReactNode } from 'react';
import { encode } from 'uqr';
import { Icon, type IconName } from '../../components/Icon/Icon';
import { detectDevice, inAppName, isRunningInstalled, type DetectedDevice, type InstallPlatform } from '../../pwa/detectPlatform';
import { promptInstall as askInstall } from '../../pwa/installPrompt';
import { msg, useT } from '../../i18n/i18n';
import { useInstallPrompt } from '../../pwa/useInstallPrompt';
import styles from './InstallPage.module.css';

const TABS: { platform: InstallPlatform; label: string }[] = [
  { platform: 'ios', label: 'iPhone / iPad' },
  { platform: 'android', label: 'Android' },
  { platform: 'desktop', label: msg('Komputer') },
];

type Step = { icon?: IconName; text: ReactNode };

/**
 * A step is one sentence for the translator, with the menu and button names in **double asterisks**: they are shown
 * bold, and word order differs per language, so they can't be glued in from outside the sentence.
 */
function rich(text: string): ReactNode {
  return text.split(/\*\*(.*?)\*\*/).map((part, index) => (index % 2 === 1 ? <b key={index}>{part}</b> : part));
}

/**
 * Public (no sign-in) install guide at /install: detects the device and browser, offers the
 * browser's own install dialog where one exists (Chromium on Android and desktop), and walks through
 * the manual steps everywhere else — iOS has no install API at all. Links opened inside WhatsApp,
 * Instagram and the like land in those apps' built-in browsers, which can't install anything, so
 * that case comes first with the way out.
 */
export default function InstallPage() {
  const t = useT();
  // On `t` so the device label ("browser bawaan WhatsApp") follows a language switch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const device = useMemo(() => detectDevice(), [t]);
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
          <h1 className={styles.title}>{t('Pasang Suwwara')}</h1>
          <p className={styles.lead}>{t('Buka langsung dari layar utama, layar penuh tanpa bar browser, dan lebih cepat.')}</p>
          <span className={styles.detected}>{t('Terdeteksi: {device}', { device: device.label })}</span>
        </header>

        {installed ? (
          <section className={styles.card}>
            <p className={styles.cardTitle}>{t('Suwwara sudah terpasang')}</p>
            <p className={styles.muted}>{t('Buka dari layar utama atau daftar aplikasimu.')}</p>
            <a className={styles.primaryButton} href="/">
              {t('Buka Suwwara')}
            </a>
          </section>
        ) : (
          <>
            {device.inApp && tab === device.platform && <InAppNotice device={device} installUrl={installUrl} />}

            <div className={styles.tabs} role="tablist" aria-label={t('Pilih perangkat')}>
              {TABS.map((item) => (
                <button
                  key={item.platform}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.platform}
                  className={[styles.tab, tab === item.platform ? styles.tabActive : ''].join(' ')}
                  onClick={() => setTab(item.platform)}
                >
                  {t(item.label)}
                </button>
              ))}
            </div>

            {tab === 'ios' && <IosGuide device={device} />}
            {tab === 'android' && <AndroidGuide device={device} canInstall={canInstall && !device.inApp} onInstall={install} />}
            {tab === 'desktop' && <DesktopGuide device={device} canInstall={canInstall} onInstall={install} installUrl={installUrl} />}
          </>
        )}

        <a className={styles.continueLink} href="/">
          {t('Lanjut ke Suwwara di browser')}
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
  const t = useT();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(installUrl);
      setCopied(true);
    } catch {
      window.prompt(t('Salin tautan ini:'), installUrl);
    }
  };
  // Android can hand the page straight to Chrome; iOS in-app browsers only offer it from their own menu.
  const chromeIntent = `intent://${window.location.host}/install#Intent;scheme=https;package=com.android.chrome;end`;
  const app = device.inApp ? inAppName(device.inApp) : t('aplikasi ini');

  return (
    <section className={[styles.card, styles.warningCard].join(' ')}>
      <p className={styles.cardTitle}>{t('Buka di {browser} dulu', { browser: device.platform === 'ios' ? 'Safari' : 'Chrome' })}</p>
      <p className={styles.muted}>
        {t('Halaman ini terbuka di browser bawaan {app}, yang tidak bisa memasang aplikasi.', { app })}{' '}
        {device.platform === 'ios'
          ? t('Ketuk ikon ⋯ atau kompas di pojok layar, lalu pilih "Buka di Safari".')
          : t('Ketuk tombol di bawah, atau buka menu ⋮ lalu pilih "Buka di Chrome".')}
      </p>
      <div className={styles.buttonRow}>
        {device.platform === 'android' && (
          <a className={styles.primaryButton} href={chromeIntent}>
            {t('Buka di Chrome')}
          </a>
        )}
        <button type="button" className={styles.secondaryButton} onClick={copy}>
          {copied ? t('Tautan disalin') : t('Salin tautan')}
        </button>
      </div>
    </section>
  );
}

function IosGuide({ device }: { device: DetectedDevice }) {
  const t = useT();
  const isIPad = device.label.startsWith('iPad');
  const safari: Step[] = [
    { text: rich(isIPad ? t('Ketuk tombol **Bagikan** di kanan atas') : t('Ketuk tombol **Bagikan** di bar bawah Safari')), icon: 'share' },
    { text: rich(t('Gulir ke bawah dan pilih **Tambah ke Layar Utama**. Tidak terlihat? Ketuk **Lainnya** (⋯) dulu')), icon: 'plus' },
    { text: rich(t('Pastikan **Buka sebagai App Web** menyala, lalu ketuk **Tambah** di kanan atas')) },
  ];
  const otherBrowser: Step[] = [
    {
      text:
        device.browser === 'chrome' ? rich(t('Ketuk tombol **Bagikan** di address bar (kanan atas)')) : rich(t('Buka menu browser, lalu pilih **Bagikan**')),
      icon: 'share',
    },
    { text: rich(t('Pilih **Tambah ke Layar Utama**')), icon: 'plus' },
    { text: rich(t('Ketuk **Tambah**')) },
  ];
  const showOther = device.platform === 'ios' && device.browser !== 'safari' && !device.inApp;

  return (
    <section className={styles.card}>
      <p className={styles.cardTitle}>{showOther ? t('Pasang dari {browser}', { browser: device.label.split(' · ')[1] }) : t('Pasang dari Safari')}</p>
      <Steps steps={showOther ? otherBrowser : safari} />
      <p className={styles.note}>
        {showOther
          ? t('Tidak ada "Tambah ke Layar Utama"? iOS versi lama hanya bisa memasang dari Safari. Buka halaman ini di Safari.')
          : t('iPhone tidak punya tombol install otomatis untuk aplikasi web, jadi pemasangannya lewat menu Bagikan.')}
      </p>
    </section>
  );
}

function AndroidGuide({ device, canInstall, onInstall }: { device: DetectedDevice; canInstall: boolean; onInstall: () => void }) {
  const t = useT();
  const steps: Step[] =
    device.browser === 'samsung'
      ? [
          { text: rich(t('Ketuk menu **≡** di bar bawah')) },
          { text: rich(t('Pilih **Tambahkan halaman ke**, lalu **Layar utama**')), icon: 'plus' },
          { text: rich(t('Ketuk **Tambah**')) },
        ]
      : device.browser === 'firefox'
        ? [
            { text: rich(t('Ketuk menu **⋮**')), icon: 'more' },
            { text: rich(t('Pilih **Instal** (atau **Tambahkan ke layar utama**)')), icon: 'download' },
            { text: rich(t('Konfirmasi dengan **Tambah**')) },
          ]
        : [
            { text: rich(t('Ketuk menu **⋮** di kanan atas')), icon: 'more' },
            { text: rich(t('Pilih **Instal aplikasi** (atau **Tambahkan ke layar utama**)')), icon: 'download' },
            { text: rich(t('Ketuk **Instal**')) },
          ];

  return (
    <section className={styles.card}>
      {canInstall ? (
        <>
          <p className={styles.cardTitle}>{t('Siap dipasang')}</p>
          <p className={styles.muted}>{t('Satu ketukan, lalu Suwwara ada di layar utama dan daftar aplikasimu.')}</p>
          <button type="button" className={styles.primaryButton} onClick={onInstall}>
            <Icon name="download" size={18} />
            {t('Pasang Suwwara')}
          </button>
          <p className={styles.dividerLabel}>{t('atau lewat menu browser')}</p>
        </>
      ) : (
        <p className={styles.cardTitle}>{t('Pasang lewat menu browser')}</p>
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
  const t = useT();
  const manual: Record<string, { title: string; steps: Step[] }> = {
    chrome: {
      title: t('Pasang dari Chrome'),
      steps: [
        { text: rich(t('Klik ikon **Instal** di ujung kanan address bar')), icon: 'download' },
        { text: rich(t('Atau buka menu **⋮** → **Transmisikan, simpan, dan bagikan** → **Instal halaman sebagai aplikasi**')), icon: 'more' },
        { text: rich(t('Klik **Instal**. Setelah terpasang, Chrome menampilkan tombol **Buka di aplikasi** di address bar')) },
      ],
    },
    edge: {
      title: t('Pasang dari Edge'),
      steps: [
        { text: rich(t('Buka menu **⋯** di kanan atas')), icon: 'more' },
        { text: rich(t('Pilih **Aplikasi** → **Instal situs ini sebagai aplikasi**')), icon: 'download' },
        { text: rich(t('Klik **Instal**')) },
      ],
    },
    safari: {
      title: t('Pasang dari Safari (macOS Sonoma ke atas)'),
      steps: [
        { text: rich(t('Buka menu **File** di bar atas')) },
        { text: rich(t('Pilih **Tambahkan ke Dock**')), icon: 'plus' },
        { text: rich(t('Klik **Tambah**')) },
      ],
    },
  };
  const guide = manual[device.browser === 'opera' ? 'chrome' : device.browser];

  return (
    <>
      <section className={styles.card}>
        {canInstall ? (
          <>
            <p className={styles.cardTitle}>{t('Siap dipasang di komputer ini')}</p>
            <p className={styles.muted}>{t('Suwwara jadi aplikasi sendiri: jendela terpisah, ada di Dock/taskbar.')}</p>
            <button type="button" className={styles.primaryButton} onClick={onInstall}>
              <Icon name="download" size={18} />
              {t('Pasang Suwwara')}
            </button>
          </>
        ) : guide ? (
          <>
            <p className={styles.cardTitle}>{guide.title}</p>
            <Steps steps={guide.steps} />
          </>
        ) : (
          <>
            <p className={styles.cardTitle}>{t('Buka di Chrome atau Edge')}</p>
            <p className={styles.muted}>
              {device.browser === 'firefox'
                ? t('Firefox belum bisa memasang aplikasi web. Buka halaman ini di Chrome atau Edge untuk memasang Suwwara.')
                : t('Browser ini belum bisa memasang aplikasi web. Buka halaman ini di Chrome atau Edge untuk memasang Suwwara.')}
            </p>
          </>
        )}
      </section>
      <section className={[styles.card, styles.qrCard].join(' ')}>
        <QrCode value={installUrl} />
        <div>
          <p className={styles.cardTitle}>{t('Pasang di HP')}</p>
          <p className={styles.muted}>{t('Scan QR ini dengan kamera HP untuk membuka halaman ini di sana.')}</p>
        </div>
      </section>
    </>
  );
}

// Drawn from uqr's module matrix as one SVG path — no canvas, no innerHTML, no network.
function QrCode({ value }: { value: string }) {
  const t = useT();
  const { size: box, data } = useMemo(() => encode(value, { ecc: 'M', border: 2 }), [value]);
  const path = data.flatMap((row, y) => row.map((on, x) => (on ? `M${x} ${y}h1v1h-1z` : ''))).join('');
  return (
    <svg className={styles.qr} viewBox={`0 0 ${box} ${box}`} shapeRendering="crispEdges" role="img" aria-label={t('QR code ke {url}', { url: value })}>
      <rect width={box} height={box} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
