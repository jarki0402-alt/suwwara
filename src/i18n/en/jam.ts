import type { Dictionary } from '../i18n';

/** English for the jam area. Key = the Indonesian text exactly as written in the code. */
export const jam: Dictionary = {
  Jam: 'Jam',
  Tutup: 'Close',
  Bagikan: 'Share',
  Kelola: 'Manage',
  'Gagal menyalin link.': "Couldn't copy the link.",
  'Dengerin bareng di Suwwara': 'Listen together on Suwwara',
  'Gabung Jam-ku di Suwwara, kode {code}': 'Join my Jam on Suwwara, code {code}',
  'Link Jam disalin.': 'Jam link copied.',

  // Jam sheet
  'Gabung Jam!': 'Joined the Jam!',
  'Kode gak ditemukan. Cek lagi kodenya.': "Code not found. Check the code and try again.",
  'Gagal gabung Jam. Coba lagi.': "Couldn't join the Jam. Try again.",
  'Jam dimulai. Bagikan link-nya ke teman.': 'Jam started. Share the link with friends.',
  'Gagal memulai Jam. Coba lagi.': "Couldn't start the Jam. Try again.",
  'Link disalin.': 'Link copied.',
  'Keluar dari Jam.': 'Left the Jam.',
  'Dengerin lagu bareng teman secara real-time. Semua orang yang gabung bisa nambah, hapus, atur ulang antrean, dan kontrol play/pause/next/back sama-sama.':
    'Listen to music with friends in real time. Everyone who joins can add, remove and reorder the queue, and control play/pause/next/back together.',
  'Memulai...': 'Starting...',
  'Mulai Jam': 'Start a Jam',
  atau: 'or',
  'Sudah ada yang mulai Jam? Masukkan kodenya di sini, karena membuka link share biasanya cuma menyalakan browser, bukan app ini.':
    'Someone already started a Jam? Enter the code here, since opening a shared link usually opens the browser, not this app.',
  KODE: 'CODE',
  Gabung: 'Join',
  '{n} orang dengerin bareng': { one: '{n} person listening together', other: '{n} people listening together' },
  Salin: 'Copy',
  Keluar: 'Leave',
  'Ketuk lagi untuk mengakhiri': 'Tap again to end',
  'Akhiri Jam untuk Semua': 'End Jam for everyone',

  // Join from a link
  'Gabung Jam?': 'Join Jam?',
  'Kamu bakal dengerin bareng room {code}. Antrean lagu kamu saat ini disimpan dulu dan dikembalikan begitu keluar dari Jam.':
    "You'll listen together in room {code}. Your current queue is saved and restored when you leave the Jam.",
  'Room Jam tidak ditemukan. Mungkin sudah berakhir.': 'Jam room not found. It may have ended.',
  'Gabung...': 'Joining...',

  // Indicators
  '{summary}. Ketuk untuk mengelola.': '{summary}. Tap to manage.',
  'Link Jam disalin. Kirim ke temanmu.': 'Jam link copied. Send it to your friends.',
  Undang: 'Invite',
  'Baru kamu': 'Just you',
  '{n} pendengar': { one: '{n} listener', other: '{n} listeners' },
  'Mendengarkan bersama': 'Listening together',
  'Menyambung ulang…': 'Reconnecting…',
  'Menyambung…': 'Connecting…',
  Host: 'Host',
  Tamu: 'Guest',
  'Jam, {status}, {people}, kamu host': "Jam, {status}, {people}, you're the host",
  'Jam, {status}, {people}, kamu tamu': "Jam, {status}, {people}, you're a guest",

  // Room events
  'Jam sudah berakhir atau room-nya sudah tidak ada.': 'The Jam has ended or the room no longer exists.',
  'Jam sudah diakhiri.': 'The Jam has ended.',
};
