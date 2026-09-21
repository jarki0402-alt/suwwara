# PRD.md — Suwwara

> Dokumen ini memetakan fitur yang **sudah ada di kode saat ini** (bukan wishlist) plus rencana pengembangan. Untuk log historis "kenapa" tiap keputusan diambil, lihat [PROGRESS.md](./PROGRESS.md). Untuk detail teknis alur data, lihat [ARCHITECTURE.md](./ARCHITECTURE.md).

## Produk dalam satu kalimat

Pemutar musik pribadi bebas iklan (PWA, installable di HP/desktop) yang meresolusi audio dari YouTube lewat `yt-dlp`, dibuat untuk lingkaran tertutup (keluarga/teman, target skala ~50 orang), gratis 100%, dan sekarang punya fitur "dengerin bareng" (Jam) serta akun tanpa password lintas device.

---

## Fitur yang sudah ada

### Playback inti
- Web Audio API dengan dua elemen `<audio>` paralel untuk crossfade antar lagu ([src/audio-engine/AudioEngine.ts](./src/audio-engine/AudioEngine.ts)).
- Resolusi kualitas high/low (mode Data Saver).
- Deteksi selesai-lagu berbasis `currentTime` vs metadata durasi asli (bukan event `'ended'` browser) — workaround bug WebKit iOS yang bisa salah hitung durasi file audio streaming progresif.
- Watchdog stall (macet di tengah lagu) dan watchdog "silent playback" (AudioContext mati suri, bug WebKit #263627).
- Auto-recovery: kalau elemen `<audio>` baru gagal `.play()` saat crossfade, elemen lama dipaksa berhenti juga (cegah dua lagu kedengeran bareng).
- Fallback ke kualitas rendah saat mid-song rebuffer (`reloadAtLowerQuality`).
- iOS: Web Audio API di-nonaktifkan total (fallback ke `<audio>` mentah) karena bug silent-audio WebKit yang tidak bisa diperbaiki dari sisi web app.

### Antrean (queue)
- Shuffle, repeat (off/all/one), next/previous, drag-to-reorder.
- Tambah ke playlist langsung dari antrean, menu opsi per lagu (sukai/putar berikutnya/hapus).
- Tampilan cuma menampilkan lagu yang sedang main + yang belum diputar (histori otomatis hilang dari tampilan).
- Auto-extend di background saat antrean mepet ujung — gak pernah benar-benar kering.
- Dedup lagu dalam antrean (in-flight lock bersama antar semua jalur penambahan).
- Cooldown 3 jam berbasis riwayat putar biar lagu yang sama gak keulang terus.

### Now Playing
- Seek bar dengan drag-to-seek.
- Lirik tersinkron otomatis (backend `/api/lyrics/:videoId`: LRCLIB lalu YouTube Music, cache Postgres; parser LRC sendiri, [src/lyrics/](./src/lyrics/)), dengan koreksi waktu per lagu, dibatasi 30fps dan berhenti total saat tab disembunyikan.
- Kontrol volume.
- Latar belakang immersive: cover album diblur+digelapkan jadi backdrop layar penuh (gaya Apple Music/Spotify), bukan warna solid — lihat [src/views/now-playing/NowPlayingView.tsx](./src/views/now-playing/NowPlayingView.tsx).

### Koleksi & personalisasi
- Lagu disukai, playlist, riwayat putar, "baru diputar" ([src/stores/libraryStore.ts](./src/stores/libraryStore.ts), [src/stores/historyStore.ts](./src/stores/historyStore.ts)).
- Mesin rekomendasi lokal berbasis histori putar ([src/recommendation/](./src/recommendation/)).
- Trending global: campuran shelf kurasi YouTube Music + query cadangan.
- "Dibuat Untukmu": dua kartu ala Spotify Daily Mix/Discover Weekly di Beranda, diklik untuk buka daftar lagu penuh (bukan langsung main) — **Temuan Mingguan** (personalisasi dari riwayat putar, mesin sama dengan "Rekomendasi Untukmu" tapi di-cache stabil per minggu kalender) dan **Lagi Viral di Indonesia** (region-specific asli dari YouTube Music, bukan cuma keyword Indonesia ditempel ke chart global — lihat [src/views/home/MadeForYouSection.tsx](./src/views/home/MadeForYouSection.tsx), [server/src/youtube/trendingId.ts](./server/src/youtube/trendingId.ts)).

### Pencarian & jelajah
- Hasil dari backend (`ytmusic-api`/`youtube-sr`), autocomplete saat mengetik, riwayat pencarian client-side.
- Grid jelajahi genre/mood (12 kategori, hasil nyata dari backend).

### Radio otomatis ("up next radio")
- Klik satu lagu dari mana pun langsung mengisi antrean dengan lagu-lagu yang benar-benar mirip (sinyal YT Music, blend 2–3 seed, coherence filter biar gak campur genre/bahasa yang gak nyambung).

### Jam — dengerin bareng (kolaboratif)
- Room berbasis kode 6-karakter, state in-memory di backend ([server/src/jam/roomManager.ts](./server/src/jam/roomManager.ts)).
- Sinkron real-time lewat Server-Sent Events (SSE) — antrean & transport (play/pause/posisi) di-broadcast ke semua member.
- Kontrol fully symmetric: siapa pun bisa ubah antrean/transport, tidak ada "host" eksklusif.
- Dedup event `advance-on-ended` antar device (mencegah lagu ke-skip dobel kalau beberapa device mendeteksi "selesai" bersamaan).
- Toleransi drift posisi antar device ~1.5 detik sebelum koreksi seek (bukan sample-accurate).
- Auto-bubar setelah 5 menit tanpa member aktif.

### Akun tanpa password & sinkronisasi lintas device
- Login wajib (nama pengguna + kata sandi; akun dibuat admin, sesi = cookie HttpOnly) — lihat [ARCHITECTURE.md](./ARCHITECTURE.md) §4. Perangkat masih punya id acak ([src/auth/deviceIdentity.ts](./src/auth/deviceIdentity.ts)) tetapi hanya untuk menandai *perangkat mana* (Connect), bukan sebagai kredensial.
- Perangkat kedua cukup masuk dengan akun yang sama; tak ada lagi pairing/QR.
- Playlist & lagu favorit sinkron ke server (`library_snapshots` table di Postgres), push debounced 800ms, hydrate dari server hanya kalau local kosong (gak pernah menimpa data device).

### PWA
- Installable, service worker via Workbox (`injectManifest`), strategi cache berbeda per jenis aset (gambar/API).
- Audio **sengaja tidak** di-cache Service Worker (dicabut total) — selalu langsung ke network, menghindari bug cache audio yang pernah bikin lagu putus/rusak.
- Prompt update, indikator offline, estimasi storage.

### Media Session API
- Metadata & kontrol lock-screen/notification bar (play/pause/next/prev/seek).
- Status play/pause lock-screen tidak lagi kedip saat ganti lagu.
- Dua elemen `<audio>` di-"prime" sekali di awal biar tombol lock-screen (next/prev) bisa memicu `.play()` di luar gesture user (batasan iOS Safari).

### Desktop & tema
- Kontrol transport di tengah bottom bar (gaya Spotify), Now Playing fullscreen di desktop.
- Tema terang/gelap manual (Sistem/Terang/Gelap), bukan cuma ikut OS.

### Backend & infrastruktur
- Audio proxy dengan dukungan Range request penuh (termasuk request tanpa header Range dari Safari) via mekanisme *chunk-stitching* — lihat [ARCHITECTURE.md](./ARCHITECTURE.md).
- Resolusi audio di-cache di Postgres (bukan in-memory) — bertahan lintas restart/redeploy.
- Prefetch resolusi lagu berikutnya di background saat lagu sekarang masih main.
- yt-dlp dijalankan sebagai microservice Python (FastAPI) yang selalu hidup — bukan spawn CLI per-request — plus provider PO-token (`bgutil-provider`, headless Chrome) untuk lolos BotGuard YouTube.
- Containerized penuh: 5 service Docker Compose (`frontend`, `backend`, `ytdlp-service`, `bgutil-provider`, `postgres`).

---

## Enhancement Plan (rencana pengembangan)

Urutan bukan berarti prioritas mutlak — silakan diskusi ulang sesuai kebutuhan riil.

### Krusial / berdampak langsung ke stabilitas
1. ~~Timeout eksplisit pada `fetch()` dari backend ke `ytdlp-service`~~ → **selesai (2026-09-19)**. `resolveAudioUncached()` sekarang pakai `AbortSignal.timeout(25000)`, dan resolusi dibagi jadi dua prioritas (`high` = lagu yang beneran mau diputar, `low` = prefetch lookahead) lewat `PriorityLimiter` custom yang menggantikan `p-limit` — concurrency tetap 1 (gak nambah beban CPU/RAM), tapi lagu yang user klik langsung gak lagi ketahan di belakang prefetch lagu lain yang belum tentu jadi didengar. Diverifikasi lewat Docker + curl: request prioritas `high` yang masuk antrean belakangan tetap selesai lebih dulu daripada request `low` yang sudah lebih dulu antre. Lihat [ARCHITECTURE.md](./ARCHITECTURE.md#potensi-memory-leak--proses-menggantung) untuk detail.
2. **Cleanup baris kedaluwarsa di tabel `audio_cache`** (Postgres) — saat ini cuma difilter `expires_at > now()` saat dibaca, baris yang sudah expired tidak pernah dihapus. Disk kecil di e2-micro bisa penuh perlahan seiring makin banyak video ID unik yang pernah diputar.
3. **Monitoring RAM sederhana** — mengingat `bgutil-provider` (headless Chrome) berbagi 1GB RAM dengan Postgres+Node+Python+nginx, satu dashboard/alert kecil (bahkan cuma `docker stats` terjadwal atau healthcheck yang expose memory) akan sangat membantu mendeteksi OOM sebelum user melapor "lagu gak mau muter".
4. **Rate limiting dasar** di endpoint publik (audio proxy, search) — target skala naik ke ~50 orang berarti risiko satu user (sengaja/tidak) memicu banyak resolusi `yt-dlp` bersamaan makin nyata, padahal `PriorityLimiter` (concurrency tetap 1) bikin satu user yang "serakah" bisa memperlambat semua orang.

### Penting, tidak mendesak
5. **Merge library, bukan cuma "hydrate kalau kosong"** — saat ini kalau device kedua sudah punya data lokal sebelum pairing, data itu tidak digabung ke akun yang di-pairing (lihat komentar di `server/src/routes/auth.ts`).
6. **Dedup toast error dobel** — `AudioEngine` dan `usePlaybackController` bisa sama-sama menulis error state untuk kegagalan yang sama saat loading awal.
7. **Test coverage untuk AudioEngine, MediaSession, dan komponen UI player** (ProgressBar, PlayerControls) — saat ini test cuma menyentuh bitrate resolver, parser LRC, dan scoring rekomendasi.
8. **Structured logging / log rotation** — backend masih pakai `console.log` polos untuk semua log resolusi audio; di VM kecil dengan uptime lama, pastikan Docker log driver dibatasi (`max-size`/`max-file`) supaya log tidak diam-diam memenuhi disk.

### Nice-to-have / masih didiskusikan
9. **HTTPS + domain lewat Cloudflare** (Tunnel atau proxy DNS) — sudah direncanakan sejak entri 2026-09-07 tapi belum dieksekusi, dengan audio streaming kemungkinan perlu bypass dari proxy Cloudflare (pakai port `8787` yang sudah dipublish) untuk menghindari batasan ToS soal trafik audio/video "gak proporsional".
10. **Prefetch untuk hasil pencarian yang baru terlihat** — bisa mempercepat lompat ke lagu baru, tapi menambah beban `yt-dlp` untuk lagu yang belum tentu diputar. Trade-off belum diputuskan, catat dulu sebagai opsi.
11. **Evaluasi ulang kebutuhan `bgutil-provider`** kalau tekanan RAM makin terasa — headless Chrome adalah komponen terberat di seluruh stack ini secara RAM. Kalau BotGuard makin ketat dan makin sering butuh restart, pertimbangkan apakah provider PO-token yang lebih ringan tersedia, atau apakah komponen ini perlu dipindah ke VM terpisah.

---

## Potensi hang / RAM — analisis singkat

Lihat rincian lengkap di [ARCHITECTURE.md](./ARCHITECTURE.md#potensi-memory-leak--proses-menggantung), ringkasannya:

- **Tidak ditemukan proses `yt-dlp`/ffmpeg yang di-spawn sebagai child process dari Node** — resolusi audio jalan di-*proses* Python (`ytdlp-service`), memanggil library `yt_dlp` langsung (bukan CLI), jadi tidak ada risiko zombie child process klasik di sisi Node.
- ~~Risiko nyata bukan "zombie process", tapi "hang tanpa timeout"~~ → **sudah ditambal (2026-09-19)**, lihat item #1 di Enhancement Plan di atas.
- ~~`fullBufferCache` tanpa hard cap~~ → **sudah ditambal (2026-09-19)** — sekarang dibatasi `MAX_FULL_BUFFER_CACHE_ENTRIES = 20`, sama pola eviction-nya dengan `chunkCache`.
- **Komponen paling boros RAM adalah `bgutil-provider` (headless Chrome)**, bukan bug di kode aplikasi — ini trade-off arsitektur (dibutuhkan untuk lolos BotGuard YouTube), bukan sesuatu yang bisa "diperbaiki" tanpa mengganti cara resolusi audio.
