import type { Dictionary } from '../i18n';

/** English for the nowPlaying area. Key = the Indonesian text exactly as written in the code. */
export const nowPlaying: Dictionary = {
  // Transport and player controls
  Putar: 'Play',
  Jeda: 'Pause',
  'Lagu sebelumnya': 'Previous song',
  'Lagu berikutnya': 'Next song',
  'Acak antrean': 'Shuffle queue',
  'Ubah mode ulang': 'Change repeat mode',
  'Posisi lagu': 'Song position',
  Volume: 'Volume',
  'Tampilkan lirik': 'Show lyrics',
  Tutup: 'Close',
  'Coba lagi': 'Try again',

  // Now Playing sheet / docked panel
  'Sedang Diputar': 'Now Playing',
  'Memutar di {name}': 'Playing on {name}',
  'Jam · {n} pendengar': { one: 'Jam · {n} listener', other: 'Jam · {n} listeners' },
  'Buka antrean': 'Open queue',
  Berikutnya: 'Up next',
  Perangkat: 'Devices',
  'Kelola Jam': 'Manage Jam',
  'Dengar bareng (Jam)': 'Listen together (Jam)',
  'Tentang Artis': 'About the artist',

  // Fullscreen stage
  Lirik: 'Lyrics',
  Antrean: 'Queue',
  Jam: 'Jam',
  Kecilkan: 'Minimize',
  Panel: 'Panel',
  'Perangkat ini': 'This device',
  'Lagu yang diputar': 'Now playing',
  'Belum ada lagu berikutnya di antrean.': 'Nothing up next in the queue yet.',
  'Geser {name} untuk mengubah urutan': 'Drag {name} to reorder',
  'Dengar bareng': 'Listen together',
  'Ajak teman ke Jam, antreannya jadi milik bersama': 'Invite friends to a Jam and share the queue',
  'Jam aktif · {people}': 'Jam active · {people}',
  'Semua bisa atur antrean dan pemutaran · kode {code}': 'Everyone can control the queue and playback · code {code}',
  Bagikan: 'Share',
  Kelola: 'Manage',
  'Di Jam, semua orang bisa menambah, menghapus, dan mengatur urutan antrean, serta memutar, menjeda, dan melompati lagu. Lagu berganti bersamaan untuk semua yang ikut.':
    'In a Jam, everyone can add, remove and reorder songs in the queue, and play, pause and skip. Songs change at the same time for everyone in it.',

  // Lyrics
  'Memuat lirik...': 'Loading lyrics...',
  'Lirik belum bisa dimuat.': "Couldn't load the lyrics.",
  'Lagu instrumental, tidak ada lirik.': 'Instrumental, no lyrics.',
  'Lirik belum tersedia untuk lagu ini.': 'No lyrics available for this song yet.',
  'Tanpa penanda waktu · {source}': 'Not time-synced · {source}',

  // Playback errors and prompts (toasts)
  'Gagal memutar lagu ini.': "Couldn't play this song.",
  'Koneksi lambat, lagu gagal dimuat.': "Slow connection, the song didn't load.",
  'Terjadi kesalahan saat memutar: sumber audio tidak tersedia.': 'Something went wrong while playing: the audio source is unavailable.',
  'Ketuk untuk lanjutkan audio Jam.': 'Tap to resume Jam audio.',

  // Music video (Lagu | Video, the theater)
  'Lagu atau video': 'Song or video',
  Lagu: 'Song',
  Video: 'Video',
  'Video musik': 'Music video',
  'Ketuk untuk memutar video': 'Tap to play the video',
  'Video tidak bisa diputar sekarang.': "The video can't be played right now.",
  'Tutup video': 'Close video',
  'Versi MV, dari awal': 'MV version, from the start',
  'Tonton MV': 'Watch MV',
  'Mundur 10 detik': 'Back 10 seconds',
  'Maju 10 detik': 'Forward 10 seconds',
  'Posisi video': 'Video position',
  'Video musik lagu ini versinya beda dari lagunya, jadi diputar dari awal dengan suaranya sendiri. Lagu dijeda dulu, lalu lanjut lagi.':
    "This song's music video is a different cut, so it plays from the start with its own sound. The song pauses, then carries on.",
  'Koneksi terlalu lambat untuk video, kembali ke lagu.': 'Connection too slow for video, back to the song.',
  'Koneksi terlalu lambat untuk video.': 'Connection too slow for video.',
};
