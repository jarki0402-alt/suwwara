import type { Dictionary } from '../i18n';

/**
 * English for the install area (InstallPage, InstallBanner, detectPlatform). Key = the Indonesian text exactly as
 * written in the code. **Bold** marks menu and button names; in English they are the names iOS, Android and the
 * browsers show in English.
 */
export const install: Dictionary = {
  'Pasang Suwwara': 'Install Suwwara',
  Pasang: 'Install',
  'Buka dari layar utama, layar penuh tanpa bar browser.': 'Open from your home screen, fullscreen without the browser bar.',
  'Buka langsung dari layar utama, layar penuh tanpa bar browser, dan lebih cepat.': 'Open straight from your home screen, fullscreen without the browser bar, and faster.',
  'Terdeteksi: {device}': 'Detected: {device}',
  'Suwwara sudah terpasang': 'Suwwara is installed',
  'Buka dari layar utama atau daftar aplikasimu.': 'Open it from your home screen or app list.',
  'Buka Suwwara': 'Open Suwwara',
  'Pilih perangkat': 'Choose a device',
  Komputer: 'Computer',
  'Lanjut ke Suwwara di browser': 'Continue to Suwwara in the browser',

  // Device label (detectPlatform)
  'browser ini': 'this browser',
  'aplikasi ini': 'this app',
  'browser bawaan {app}': '{app} built-in browser',

  // In-app browser notice
  'Salin tautan ini:': 'Copy this link:',
  'Buka di {browser} dulu': 'Open in {browser} first',
  'Halaman ini terbuka di browser bawaan {app}, yang tidak bisa memasang aplikasi.': "This page opened in {app}'s built-in browser, which can't install apps.",
  'Ketuk ikon ⋯ atau kompas di pojok layar, lalu pilih "Buka di Safari".': 'Tap the ⋯ or compass icon in the corner of the screen, then choose "Open in Safari".',
  'Ketuk tombol di bawah, atau buka menu ⋮ lalu pilih "Buka di Chrome".': 'Tap the button below, or open the ⋮ menu and choose "Open in Chrome".',
  'Buka di Chrome': 'Open in Chrome',
  'Tautan disalin': 'Link copied',
  'Salin tautan': 'Copy link',

  // iOS
  'Ketuk tombol **Bagikan** di kanan atas': 'Tap the **Share** button at the top right',
  'Ketuk tombol **Bagikan** di bar bawah Safari': "Tap the **Share** button in Safari's bottom bar",
  'Gulir ke bawah dan pilih **Tambah ke Layar Utama**. Tidak terlihat? Ketuk **Lainnya** (⋯) dulu': "Scroll down and choose **Add to Home Screen**. Don't see it? Tap **More** (⋯) first",
  'Pastikan **Buka sebagai App Web** menyala, lalu ketuk **Tambah** di kanan atas': 'Make sure **Open as Web App** is on, then tap **Add** at the top right',
  'Ketuk tombol **Bagikan** di address bar (kanan atas)': 'Tap the **Share** button in the address bar (top right)',
  'Buka menu browser, lalu pilih **Bagikan**': 'Open the browser menu, then choose **Share**',
  'Pilih **Tambah ke Layar Utama**': 'Choose **Add to Home Screen**',
  'Ketuk **Tambah**': 'Tap **Add**',
  'Pasang dari {browser}': 'Install from {browser}',
  'Pasang dari Safari': 'Install from Safari',
  'Tidak ada "Tambah ke Layar Utama"? iOS versi lama hanya bisa memasang dari Safari. Buka halaman ini di Safari.':
    'No "Add to Home Screen"? Older iOS versions can only install from Safari. Open this page in Safari.',
  'iPhone tidak punya tombol install otomatis untuk aplikasi web, jadi pemasangannya lewat menu Bagikan.': "iPhone has no automatic install button for web apps, so you install it from the Share menu.",

  // Android
  'Ketuk menu **≡** di bar bawah': 'Tap the **≡** menu in the bottom bar',
  'Pilih **Tambahkan halaman ke**, lalu **Layar utama**': 'Choose **Add page to**, then **Home screen**',
  'Ketuk menu **⋮**': 'Tap the **⋮** menu',
  'Pilih **Instal** (atau **Tambahkan ke layar utama**)': 'Choose **Install** (or **Add to Home screen**)',
  'Konfirmasi dengan **Tambah**': 'Confirm with **Add**',
  'Ketuk menu **⋮** di kanan atas': 'Tap the **⋮** menu at the top right',
  'Pilih **Instal aplikasi** (atau **Tambahkan ke layar utama**)': 'Choose **Install app** (or **Add to Home screen**)',
  'Ketuk **Instal**': 'Tap **Install**',
  'Siap dipasang': 'Ready to install',
  'Satu ketukan, lalu Suwwara ada di layar utama dan daftar aplikasimu.': 'One tap, and Suwwara is on your home screen and in your app list.',
  'atau lewat menu browser': 'or from the browser menu',
  'Pasang lewat menu browser': 'Install from the browser menu',

  // Desktop
  'Pasang dari Chrome': 'Install from Chrome',
  'Klik ikon **Instal** di ujung kanan address bar': 'Click the **Install** icon at the right end of the address bar',
  'Atau buka menu **⋮** → **Transmisikan, simpan, dan bagikan** → **Instal halaman sebagai aplikasi**': 'Or open the **⋮** menu → **Cast, save, and share** → **Install page as app**',
  'Klik **Instal**. Setelah terpasang, Chrome menampilkan tombol **Buka di aplikasi** di address bar': 'Click **Install**. Once installed, Chrome shows an **Open in app** button in the address bar',
  'Pasang dari Edge': 'Install from Edge',
  'Buka menu **⋯** di kanan atas': 'Open the **⋯** menu at the top right',
  'Pilih **Aplikasi** → **Instal situs ini sebagai aplikasi**': 'Choose **Apps** → **Install this site as an app**',
  'Klik **Instal**': 'Click **Install**',
  'Pasang dari Safari (macOS Sonoma ke atas)': 'Install from Safari (macOS Sonoma or later)',
  'Buka menu **File** di bar atas': 'Open the **File** menu in the menu bar',
  'Pilih **Tambahkan ke Dock**': 'Choose **Add to Dock**',
  'Klik **Tambah**': 'Click **Add**',
  'Siap dipasang di komputer ini': 'Ready to install on this computer',
  'Suwwara jadi aplikasi sendiri: jendela terpisah, ada di Dock/taskbar.': 'Suwwara becomes its own app: a separate window, in your Dock/taskbar.',
  'Buka di Chrome atau Edge': 'Open in Chrome or Edge',
  'Firefox belum bisa memasang aplikasi web. Buka halaman ini di Chrome atau Edge untuk memasang Suwwara.': "Firefox can't install web apps yet. Open this page in Chrome or Edge to install Suwwara.",
  'Browser ini belum bisa memasang aplikasi web. Buka halaman ini di Chrome atau Edge untuk memasang Suwwara.': "This browser can't install web apps yet. Open this page in Chrome or Edge to install Suwwara.",
  'Pasang di HP': 'Install on your phone',
  'Scan QR ini dengan kamera HP untuk membuka halaman ini di sana.': "Scan this QR code with your phone's camera to open this page there.",
  'QR code ke {url}': 'QR code to {url}',

  // registerSW
  'Update tersedia': 'Update available',
  Update: 'Update',
  'Update tersedia · Muat ulang': 'Update available · Reload',
  'Muat ulang untuk memakai versi terbaru.': 'Reload to use the latest version.',
  'Muat ulang': 'Reload',
  'Suwwara siap digunakan secara offline.': 'Suwwara is ready to use offline.',
};
