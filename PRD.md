# PRD.md · Suwwara

> Dokumen ini memetakan fitur yang **sudah ada di kode saat ini** (bukan wishlist), rencana pengembangan, dan keputusan yang sengaja **tidak** diambil. Untuk log historis "kenapa" tiap keputusan diambil, lihat [PROGRESS.md](./PROGRESS.md). Untuk detail teknis alur data, lihat [ARCHITECTURE.md](./ARCHITECTURE.md). Terakhir ditinjau ulang terhadap kode: 2026-11-11.

## Produk dalam satu kalimat

Pemutar musik dan podcast pribadi bebas iklan (PWA, dipasang di HP/tablet/desktop) yang meresolusi audio dari YouTube lewat `yt-dlp` di VM 1GB sendiri, untuk lingkaran tertutup (keluarga/teman, target ~50 orang, akun dibuat admin), gratis 100%, dengan dengar bareng (Jam), pindah perangkat ala Spotify Connect, video musik, dan dua bahasa.

---

## Fitur yang sudah ada

### Playback inti
- Dua elemen `<audio>` bergantian ([src/audio-engine/AudioEngine.ts](./src/audio-engine/AudioEngine.ts)): lagu berikutnya di-preload di elemen cadangan, jadi pergantian lagu nyaris tanpa jeda.
- **Desktop**: dialirkan lewat Web Audio (crossfade 0,35 dtk dan fade saat jeda). **iPhone/iPad dan Android (HP + tablet)**: `<audio>` polos tanpa Web Audio ([platform.ts](./src/audio-engine/platform.ts) `usesPlainMediaElements`), karena WebKit membisukan audio di background dan Chrome Android menangguhkan `AudioContext` saat layar mati. Harganya: potongan langsung tanpa crossfade di perangkat itu.
- Deteksi selesai-lagu dari `currentTime` vs durasi asli metadata (bukan event `'ended'`): WebKit iOS bisa salah hitung durasi file streaming (pernah tepat 2×).
- Watchdog macet di tengah lagu, watchdog "silent playback", batas 3× gagal beruntun supaya tidak menge-skip seluruh antrean saat internet mati.
- Android: pertahanan 5 detik melawan jeda dari sistem saat app ditinggal, tombol Back tidak lagi menutup PWA (yang mematikan musik).
- Fallback ke kualitas rendah saat rebuffer di tengah lagu.

### Kualitas audio & hemat data
- **Normal: AAC 128 kbps (m4a, itag 140)**, kira-kira setara Spotify Free. **Data Saver**: m4a bitrate terendah. Episode podcast selalu bitrate rendah (~49 kbps, ~22MB/jam).
- Pemilihan format di [server/ytdlp-service/main.py](./server/ytdlp-service/main.py) (`format_selector`): m4a dulu, karena klien `visionos` (~1,8 dtk per resolve) hanya memberi m4a, dan m4a aman di semua perangkat termasuk iPhone di background.
- **Simpan lagu di perangkat** (bawaan On) dan **Unduhan** manual, satu wadah "Tersimpan Offline" ([AudioCache.ts](./src/audio-engine/AudioCache.ts)). Salinan lama berisi file video otomatis dibuang ([videoTrack.ts](./src/audio-engine/videoTrack.ts)).

### Antrean (queue)
- Shuffle, repeat (off/all/one), next/previous, drag-to-reorder, menu ⋯ seragam (sukai, putar selanjutnya, tambah ke playlist, hapus).
- Hanya lagu yang sedang main + yang belum diputar yang tampil.
- Auto-extend di background saat antrean mepet ujung, dedup lagu (lock in-flight bersama), cooldown 3 jam berbasis riwayat.

### Now Playing
- Latar immersive dari cover yang diburamkan. Desktop: panel kanan gaya Spotify + layar penuh dengan tab **Lirik · Video · Antrean · Jam**. HP: sheet layar penuh dengan gestur tarik-tutup.
- **Lirik tersinkron** (backend `/api/lyrics/:videoId`: LRCLIB lalu YouTube Music, cache Postgres, koreksi waktu per lagu, klik baris untuk lompat), dibatasi 30fps dan berhenti saat tab tersembunyi. Episode podcast: transkrip.
- **HP: layar lirik penuh ala Spotify**: judul dan artis di tengah atas tanpa cover, lirik memakai seluruh tinggi, seek bar + 3 tombol di bawah.
- Antrean di panel Now Playing ikut berwarna lagu yang diputar.
- Kontrol volume (desktop), kartu "Berikutnya" untuk episode (juga di layar penuh).

### Video musik
- Tombol **Lagu | Video** untuk MV resmi yang sinkron (lanjut di detik yang sama). MV versi beda jadi tombol terpisah **"Tonton MV"** (dari awal, suaranya sendiri).
- Pencocokan MV mengecek judul & channel asli lewat oEmbed YouTube supaya tidak mengambil video lirik dari channel lain ([video.ts](./server/src/youtube/video.ts)).
- Kualitas adaptif ala YouTube (HLS dari byte range file asli, 240p sampai 1080p, tanpa remux), menu Kualitas video, mode teater.
- Bisa dimatikan seluruhnya dengan `VIDEO_ENABLED=false`.

### Podcast
- Tab ke-5: cari channel/episode YouTube, halaman channel (banner utuh, foto, subscriber, Terbaru/Populer/Seri), "Episode baru" dari RSS, Lanjutkan dengar.
- Didengar **sebagai audio saja** (hemat bandwidth), tetap jalan di background. Shorts, live, dan video khusus member disaring.
- Safari/iPhone: episode diputar lewat playlist HLS dari indeks file itu sendiri, mulai ~3 dtk (sebelumnya 15–25 dtk).
- Posisi tersimpan di server dan **lanjut lintas perangkat** (HP ↔ laptop, toast "Lanjut dari ...").
- Judul episode selalu bahasa aslinya (`hl=id`), hanya keterangan kecil (views, "2 hari lalu") yang diterjemahkan saat app berbahasa Inggris. Tanggal dengan nama bulan.
- Nama channel bisa diklik dari mana pun (kartu, baris, antrean, banner Lanjutkan).

### Koleksi & personalisasi
- Lagu Disukai (halaman sendiri ala Liked Songs), playlist, riwayat putar, "baru diputar". Playlist dibuka di atas menu yang sedang aktif.
- **Impor dari Spotify** lewat file Exportify (ZIP/CSV dibaca di browser, dicocokkan ke YT Music di background) ([src/import/](./src/import/)).
- Rekomendasi lokal dari riwayat ([src/recommendation/](./src/recommendation/)), Mix artis/genre, "Dibuat Untukmu": **Temuan Mingguan** dan **Lagi Viral di Indonesia** ([trendingId.ts](./server/src/youtube/trendingId.ts)).
- Halaman Artis & Album ala Spotify (angka pemutaran riil, bio Wikipedia), nama artis bisa diklik di mana-mana.

### Pencarian & jelajah
- Hasil dari backend (`ytmusic-api`/`youtube-sr`), autocomplete, riwayat pencarian client-side, cari artis.
- Grid jelajah genre/mood dengan hasil nyata dari backend, trending global.

### Radio otomatis ("up next radio")
- Klik satu lagu dari mana pun langsung mengisi antrean dengan lagu yang benar-benar mirip (sinyal YT Music, blend 2–3 seed, filter koherensi genre/bahasa).

### Jam · dengar bareng
- Room kode 6 karakter, state in-memory di backend ([roomManager.ts](./server/src/jam/roomManager.ts)), sinkron lewat SSE.
- Kontrol simetris (tidak ada host eksklusif), dedup `advance-on-ended`, toleransi drift ~1,5 dtk.
- Tahan sinyal putus sebentar (maks. 3 stream per perangkat), auto-bubar 5 menit tanpa anggota aktif.

### Akun, Connect & sinkron lintas perangkat
- **Login wajib** (nama pengguna + kata sandi, akun dibuat admin, sesi cookie HttpOnly, pembatas percobaan login [loginLimiter.ts](./server/src/auth/loginLimiter.ts)). Lihat [ARCHITECTURE.md](./ARCHITECTURE.md) §4.
- **Connect ala Spotify**: satu sesi pemutaran per akun. HP, laptop, tablet melihat lagu yang sama, bisa jadi remote penuh, atau melanjutkan di perangkat lain ([src/connect/](./src/connect/)).
- Playlist, lagu disukai, riwayat, dan mix sinkron ke server dengan versi. Data dua perangkat **digabung**, tidak ada yang dibuang ([server/src/library/merge.ts](./server/src/library/merge.ts)).

### Konsol admin
- Berdiri sendiri (admin mengelola, tidak mendengarkan), bahasa Indonesia saja ([src/views/admin/](./src/views/admin/)).
- Kelola akun, laporan pemutaran dari perangkat.
- **Perkiraan tagihan Google Cloud** ([metrics/billing.ts](./server/src/metrics/billing.ts)), dikalibrasi dari CSV billing asli: satu-satunya biaya adalah data keluar ke Cloudflare (*Carrier Peering*, tidak termasuk jatah gratis 200 GiB), ±Rp 1.450/GiB × 1,08 (`EGRESS_RP_PER_GIB`, `EGRESS_OVERHEAD`); VM e2-micro, disk 30 GB, IP publik Rp 0 (free tier). Bulan dipotong waktu Pacific seperti tagihan Google, perkiraan akhir bulan dari laju 7 hari terakhir, biaya per jenis dan per pengguna, cek syarat free tier (RAM ~1 GB, disk ≤ 30 GB).
- **Pemakaian rinci, angka saja (tanpa judul lagu)**: per jam dan per jenis **lagu / podcast / video** (`usage_hourly`, 90 hari; `usage_daily` 400 hari). Waktu dengar dan lagu dimulai/selesai/di-skip dihitung **HP** ([listeningStats.ts](./src/stats/listeningStats.ts), hanya membaca status pemutar, kirim tiap 5 menit) karena lagu dari simpanan HP tak lewat server; MB dihitung server, termasuk berapa yang dari cache disk. Tampil sebagai grafik per hari, heatmap hari × jam, tabel per pengguna (bisa diurutkan, CSV), halaman **detail per pengguna** (48 jam terakhir, perangkat, laporan masalah), tab **Laporan** bulanan (vs bulan lalu, CSV, cetak/PDF), statistik di tab Podcast.
- **Sistem**: kondisi VM tiap 5 menit tersimpan 14 hari (`system_samples`): RAM, CPU, lama resolve, cache lagu, disk; plus isi cache lagu di disk saat ini.
- Data contoh untuk laptop: `scripts/admin-demo-seed.sql` (menolak jalan tanpa `-v i_am_local=1`) dan `scripts/admin-demo-clear.sql`.

### Tampilan
- 6 palet + **Bara** (bawaan), terang/gelap/sistem, font Figtree. **Liquid Glass** opsional (bawaan Mati).
- **Halaman berwarna dari gambarnya** ala Apple Music: artis, album, playlist, mix, Lagu Disukai, channel podcast ([useImageTint.ts](./src/hooks/useImageTint.ts)). Dihitung di perangkat dari salinan 64px di kanvas 24×24, tanpa kerja server, teks putih tetap kontras ≥ ~5:1. Hero dan banner dari tepi ke tepi, tombol dan search box kaca.
- Desktop: scrollbar panel melayang di atas halaman ([PanelScrollbar.tsx](./src/app-shell/PanelScrollbar.tsx)) supaya warna dan banner sampai ke tepi, sidebar bisa diciutkan jadi ikon, layar penuh sungguhan, pintasan keyboard, bar atas Beranda simetris.
- Notifikasi gaya Dynamic Island (HP: turun dari bawah status bar; desktop: pojok kanan atas), strip status internet di tepi bawah.
- **iPhone (PWA terpasang)**: pita polos setinggi status bar berwarna halaman, jadi blur status bar iOS 26 tidak lagi mengaburkan konten. Sudah dicek di iPhone asli (2026-11-11).

### Bahasa
- Indonesia + Inggris, sistem sendiri tanpa library ([src/i18n/i18n.ts](./src/i18n/i18n.ts)): teks Indonesia sebagai kunci, kamus Inggris jadi chunk terpisah yang hanya diunduh pengguna bahasa Inggris. Dijaga test (tak ada teks JSX mentah, tak ada kunci tanpa Inggris).
- Tanpa em dash di teks aplikasi, dijaga test ([tests/text/noEmDash.test.ts](./tests/text/noEmDash.test.ts)).

### PWA
- **PWA saja, tanpa pembungkus native** (Capacitor/iOS dicabut 2026-09-20). Halaman publik `/install` dengan panduan per perangkat/browser.
- Service worker Workbox (`injectManifest`). Audio **sengaja tidak** di-cache Service Worker.
- Pembaruan: dicek saat app dibuka lagi dan tiap jam. Dipasang otomatis kalau tidak ada yang diputar (saat mulai, atau setelah ditinggal 30+ menit), kalau tidak muncul notifikasi "Update". Manual: Pengaturan → Cek pembaruan.

### Media Session API
- Metadata & kontrol layar kunci/notifikasi (play/pause/next/prev/seek), status tidak berkedip saat ganti lagu.
- Elemen `<audio>` di-"prime" di awal supaya next/prev dari layar kunci bisa memicu `.play()` (batasan iOS).

### Backend & infrastruktur
- Audio proxy dengan Range request penuh lewat *chunk-stitching* 256KB, `chunkCache` ber-batas (40MB) ([audio.ts](./server/src/routes/audio.ts)).
- Resolusi audio di-cache di Postgres, cache file audio di disk (maks. `AUDIO_CACHE_MAX_MB`, bawaan 6GB, LRU) ([diskCache.ts](./server/src/youtube/diskCache.ts)), pemanas resolve untuk lagu yang sering diputar.
- `yt-dlp` sebagai microservice Python (FastAPI) yang selalu hidup, klien `visionos` → `web` → `android/ios`, `PriorityLimiter(1)` dengan lane high/low, timeout 25 dtk.
- `bgutil-provider` (headless Chrome, token PO) dikunci versi sama dengan plugin pip.
- 5 service Docker Compose (`frontend`, `backend`, `ytdlp-service`, `bgutil-provider`, `postgres`), log Docker dibatasi 10MB × 3 per service.
- HTTPS + domain lewat **Cloudflare Tunnel** (koneksi keluar saja, port aplikasi tidak dibuka ke internet). Lihat [DEPLOY.md](./DEPLOY.md).

---

## Enhancement Plan (rencana pengembangan)

Urutan bukan prioritas mutlak, silakan didiskusikan ulang sesuai kebutuhan riil.

### Sudah selesai (dari rencana lama)
- ~~Timeout eksplisit `fetch()` ke `ytdlp-service`~~ + antrean prioritas high/low (2026-09-19).
- ~~Monitoring RAM sederhana~~ → tab Sistem di konsol admin.
- ~~Merge library, bukan cuma hydrate kalau kosong~~ → sinkron berversi + merge di server.
- ~~Log rotation~~ → `max-size: 10m`, `max-file: 3` di semua service.
- ~~HTTPS + domain~~ → Cloudflare Tunnel.
- ~~`fullBufferCache` tanpa hard cap~~ → `MAX_FULL_BUFFER_CACHE_ENTRIES = 20`.

### Masih terbuka, kecil
1. **Hapus baris kedaluwarsa di `audio_cache`**. Saat ini hanya difilter saat dibaca (`expires_at > now()`) dan dihapus per video saat link mati. Lagu yang lama tak diputar meninggalkan satu baris kecil selamanya. Tumbuh sangat pelan untuk ~50 orang (perkiraan beberapa MB per tahun), tidak mendesak. Usulan: hapus yang sudah mati > 7 hari, menumpang di timer yang sudah ada, tanpa proses baru.
2. **Rate limit di pencarian dan `/api/audio`**. Sekarang hanya login, Connect, dan laporan diagnostik yang dibatasi. Risiko kecil selama pengguna hanya orang yang dikenal (login wajib). Baru perlu kalau Suwwara dibuka lebih luas.
3. **Test coverage AudioEngine, Media Session, komponen player**. Sudah ada test untuk platform, bitrate resolver, cache policy, video track, Connect, Jam guards, antrean, rekomendasi, lirik, podcast, dan server; yang belum adalah mesin audionya sendiri (paling cocok dites di perangkat asli).
4. **Dedup toast error dobel** saat loading awal (`AudioEngine` dan `usePlaybackController` bisa sama-sama menulis error untuk kegagalan yang sama). Perlu dicek ulang apakah masih terjadi.

### Nice-to-have / masih didiskusikan
5. **Prefetch untuk hasil pencarian yang baru terlihat**: mempercepat klik dari pencarian, tapi menambah beban `yt-dlp` untuk lagu yang belum tentu diputar.
6. **Evaluasi ulang `bgutil-provider`** kalau tekanan RAM makin terasa: komponen terberat di stack. Kalau BotGuard makin ketat, pertimbangkan provider yang lebih ringan atau VM terpisah.

---

## Sengaja tidak dikerjakan (dan alasannya)

Dicatat supaya tidak dibahas ulang dari nol.

| Ide | Keputusan | Alasan |
|---|---|---|
| Aplikasi native iOS (Capacitor) | Dicabut 2026-09-20 | Apple ID gratis kedaluwarsa tiap 7 hari. Lambatnya start ternyata antrean server, bukan platformnya. |
| Aplikasi Google TV | Tidak (2026-11) | PWA tidak bisa dipasang seperti app di Google TV, perlu APK/TWA terpisah. Tidak sebanding. |
| Dynamic Island / notch di Mac | Tidak di Suwwara | Halaman web tidak bisa menggambar di area notch. Aplikasi notch pihak ketiga yang membaca "Now Playing" macOS sudah bisa menampilkan Suwwara tanpa perubahan kode. |
| Efek audio (slowed, reverb, 8D, bass boost) | Tidak (2026-11) | Manfaat kecil. Slowed aman, tapi reverb/8D butuh Web Audio, yang justru dimatikan di iPhone/Android demi pemutaran di background. Tidak membebani server sama sekali, risikonya di stabilitas pemutaran. |
| Audio Opus (itag 251) | Tetap AAC 128 (2026-11) | Peningkatan tipis. Klien `visionos` (cepat) hanya memberi m4a; Opus kemungkinan butuh klien `web` (4–6 dtk per resolve), WebM/Opus rawan di iPhone, cache jadi dua format, bandwidth +10–25%. Bisa dievaluasi lagi kalau `visionos` ternyata juga menawarkan 251. |
| AAC 256 (itag 141) | Tidak | Hanya untuk akun YouTube Music Premium lewat cookie, risiko akun di-flag/ban. |
| FLAC / lossless | Tidak mungkin dari YouTube | YouTube tidak punya lossless. Sumber lain (Tidal/Qobuz/Deezer) berbayar dan melanggar ketentuan. Bandwidth 6–8× (≈400–600MB/jam vs ≈60MB/jam). |
| Login Spotify langsung | Tidak | App baru wajib pemilik Premium, maks. 5 user terdaftar manual, tak bisa membaca isi playlist buatan Spotify. Diganti impor file Exportify. |
| Proses audio di server (ffmpeg, remux, transcode) | Tidak | Berat untuk VM 1GB (CLAUDE.md aturan #7). Backend hanya meneruskan byte. |

---

## Potensi hang / RAM · analisis singkat

Rincian lengkap di [ARCHITECTURE.md](./ARCHITECTURE.md#potensi-memory-leak--proses-menggantung). Ringkasnya:

- **Tidak ada proses `yt-dlp`/ffmpeg yang di-spawn dari Node**: resolusi berjalan di proses Python (`ytdlp-service`) yang memanggil library `yt_dlp` langsung, jadi tidak ada risiko zombie child process.
- **Hang tanpa timeout**: sudah ditambal (timeout 25 dtk ke `ytdlp-service`, timeout di fetch eksternal baru seperti oEmbed 4 dtk, progress podcast 4 dtk). Pola wajib untuk fetch baru: CLAUDE.md aturan #8.
- **Semua cache in-memory punya batas**: `chunkCache`, `fullBufferCache`, `hotCache`, cache podcast, cache tint di klien (120 URL), dll. Cache disk audio juga dibatasi (LRU).
- **Komponen paling boros RAM adalah `bgutil-provider` (headless Chrome)**, bukan bug kode aplikasi. Ini trade-off arsitektur untuk lolos BotGuard YouTube. Pantau lewat tab Sistem di konsol admin.
