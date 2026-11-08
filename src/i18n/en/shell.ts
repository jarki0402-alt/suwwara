import type { Dictionary } from '../i18n';

/** English for the shell area. Key = the Indonesian text exactly as written in the code. */
export const shell: Dictionary = {
  // Tabs / sidebar
  Beranda: 'Home',
  Cari: 'Search',
  Koleksi: 'Library',
  Pengaturan: 'Settings',
  'Ada pembaruan': 'Update available',
  Koleksimu: 'Your Library',
  'Buat playlist baru': 'Create new playlist',
  'Lagu Disukai': 'Liked Songs',
  '{n} trek': { one: '{n} track', other: '{n} tracks' },
  'Daftar Putar': 'Playlist',
  'Playlist Baru': 'New Playlist',
  Buat: 'Create',

  // Player bar
  'Putar di sini': 'Play here',
  'Di sini': 'Here',
  'Perbesar layar penuh': 'Expand to fullscreen',

  // Pane resizers
  'Seret untuk mengubah lebar, klik dua kali untuk mengembalikan': 'Drag to resize, double-click to reset',
  'Ubah lebar sidebar': 'Resize sidebar',
  'Ubah lebar panel kanan': 'Resize right panel',

  // Top bar search
  'Keluar dari layar penuh': 'Exit fullscreen',
  'Layar penuh': 'Fullscreen',
  'Keluar dari layar penuh (F)': 'Exit fullscreen (F)',
  'Layar penuh (F)': 'Fullscreen (F)',
  'Cari lagu, artis, atau album…': 'Search songs, artists, or albums…',
  'Cari lagu, artis, atau album': 'Search songs, artists, or albums',
  'Pencarian terakhir': 'Recent searches',
  'Hapus semua': 'Clear all',
  'Hapus "{term}" dari riwayat': 'Remove "{term}" from history',
  'Mencari…': 'Searching…',
  'Tidak ada hasil untuk “{query}”.': 'No results for “{query}”.',
  'Artis · Lihat profil': 'Artist · View profile',

  // Devices (Connect)
  'Sedang di Jam': 'In a Jam',
  'Memutar · {song}': 'Playing · {song}',
  'Dijeda · {song}': 'Paused · {song}',
  'Siap memutar': 'Ready to play',
  'Perangkat ini · {name}': 'This device · {name}',
  '{name} tidak terhubung.': '{name} is not connected.',
  'Selama kamu di Jam, musik tidak bisa dipindah ke perangkat lain.': "While you're in a Jam, music can't be moved to another device.",
  'Sedang memutar di': 'Now playing on',
  'Dijeda di': 'Paused on',
  'Pindahkan ke': 'Move to',
  'Perangkat aktif': 'Active devices',
  'Belum ada perangkat lain yang aktif. Buka Suwwara dengan akun yang sama di HP, tablet, atau laptop, lalu perangkat itu akan muncul di sini.':
    'No other devices are active yet. Open Suwwara with the same account on a phone, tablet or laptop and it will show up here.',
  'Ketuk perangkat untuk memindahkan musik ke sana, lanjut dari detik yang sama. Perangkatnya harus sedang membuka Suwwara.':
    'Tap a device to move the music there, picking up at the same second. The device must have Suwwara open.',
  'Putar lagu dulu, lalu pilih di perangkat mana musiknya diputar.': 'Play a song first, then choose which device plays it.',
  'Dijeda, sekarang memutar di {device}.': 'Paused, now playing on {device}.',
  'perangkat lain': 'another device',
  'Ketuk untuk melanjutkan audio.': 'Tap to resume audio.',
  'Gagal memutar di perangkat ini.': "Couldn't play on this device.",

  // Device labels / relative time
  '{browser} di {os}': '{browser} on {os}',
  'Perangkat tak dikenal': 'Unknown device',
  'baru saja': 'just now',
  '{n} menit lalu': { one: '{n} minute ago', other: '{n} minutes ago' },
  '{n} jam lalu': { one: '{n} hour ago', other: '{n} hours ago' },
  '{n} hari lalu': { one: '{n} day ago', other: '{n} days ago' },
  'Tekan Kembali sekali lagi untuk keluar. Musik akan berhenti; pakai tombol Home supaya tetap diputar.': 'Press Back again to exit. The music will stop; use the Home button to keep it playing.',
  // BottomNav sidebar fold
  'Ciutkan sidebar': 'Collapse sidebar',
  'Lebarkan sidebar': 'Expand sidebar',
  // ConnectionBanner
  'Tidak ada koneksi internet': 'No internet connection',
  'Lagu yang tersimpan tetap bisa diputar.': 'Saved songs can still be played.',
  'Koneksi lambat, lagu sedang dimuat…': 'Slow connection, loading the song…',
  'Kembali online': 'Back online',
};
