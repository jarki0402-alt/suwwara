# ARCHITECTURE.md — Alur Data Suwwara

Dokumen ini fokus ke **bagaimana data mengalir**, bukan daftar fitur (lihat [PRD.md](./PRD.md)) atau cara menjalankan project (lihat [CLAUDE.md](./CLAUDE.md)).

## Peta service (docker-compose.yml)

```
┌──────────────┐      /api/*       ┌──────────────┐
│   frontend   │ ────────────────▶ │   backend    │
│ nginx:alpine │ ◀──── static ──── │ Node/Express │
│  :8080→:80   │                   │    :8787     │
└──────────────┘                   └──────┬───────┘
                                           │
                     ┌─────────────────────┼─────────────────────┐
                     │                     │                     │
                     ▼                     ▼                     ▼
             ┌───────────────┐    ┌────────────────┐    ┌───────────────┐
             │   postgres    │    │  ytdlp-service  │    │ googlevideo.  │
             │ (internal DB, │    │ Python/FastAPI  │    │ com (YouTube  │
             │ tidak publish │    │     :8000       │    │  CDN, upstream)│
             │  ke host)     │    └────────┬────────┘    └───────────────┘
             └───────────────┘             │
                                            ▼
                                  ┌───────────────────┐
                                  │  bgutil-provider   │
                                  │ (headless Chrome,  │
                                  │  PO-token BotGuard)│
                                  └───────────────────┘
```

`vercel/` ada di repo sebagai proyek terpisah tapi **tidak aktif** — sempat dicoba menerima trafik search/browse/details/similar/trending, lalu di-revert kembali ke backend lokal (lihat commit `2faa123`) karena cold-start serverless lebih mahal daripada proses GCP yang selalu hidup untuk pola traffic app ini.

## 1. Alur pencarian & metadata

```
Browser (SearchView) → GET /api/search?q=... (nginx proxy_pass) → backend:8787
  → server/src/routes/search.ts → server/src/youtube/search.ts (ytmusic-api/youtube-sr)
  → YouTube Music (scraping/API tidak resmi) → JSON hasil → balik ke browser
```

Modul `server/src/youtube/{search,browse,details,similar}.ts` sengaja ditulis lepas dari Express (murni fungsi) — itu sebabnya bisa langsung "diporting" apa adanya ke `vercel/lib/` saat sempat dicoba di Vercel.

## 2. Alur resolusi + streaming audio (jalur paling kompleks di app ini)

Ini alur inti yang paling banyak melewati iterasi debugging (lihat [PROGRESS.md](./PROGRESS.md)), karena harus menyeimbangkan tiga kendala sekaligus: **VM 1GB RAM**, **BotGuard anti-bot YouTube (timeout ~30 detik per koneksi long-lived)**, dan **kuirk iOS Safari** (request tanpa header `Range`, salah hitung durasi file).

### Langkah demi langkah

1. **Frontend memicu resolve lebih awal** — begitu lagu *sekarang* mulai main, `prefetchAudioResolveOnly()` ([src/api/musicClient.ts](./src/api/musicClient.ts)) memanggil `GET /api/audio/:videoId/resolve` untuk lagu *berikutnya* di antrean secara fire-and-forget. Tujuannya: proses `yt-dlp` yang makan beberapa detik sudah selesai duluan sebelum user benar-benar sampai ke lagu itu.
2. **AudioEngine minta audio** — `<audio>` element di-set `src = /api/audio/:videoId?quality=high|low`, browser sendiri yang mengirim request HTTP (dengan atau tanpa header `Range`, tergantung platform).
3. **Backend menerima request** ([server/src/routes/audio.ts](./server/src/routes/audio.ts)) → panggil `resolveAudio(videoId, quality)` ([server/src/youtube/stream.ts](./server/src/youtube/stream.ts)):
   - Cek cache di **Postgres** (`audio_cache` table, TTL 3 jam) — kalau hit, langsung pakai URL yang sudah ada.
   - Kalau ada resolve lain untuk video+quality yang sama sedang berjalan (`inFlight` Map in-memory), request ini numpang menunggu hasil yang sama alih-alih memicu resolve baru.
   - Kalau cache miss & tidak ada yang in-flight: `resolveAudioUncached()` → `fetch()` ke `http://ytdlp-service:8000/resolve`, dibungkus `pLimit(1)` (maksimal **satu** resolusi jalan bersamaan di seluruh app).
4. **`ytdlp-service` (Python/FastAPI)** ([server/ytdlp-service/main.py](./server/ytdlp-service/main.py)) memanggil library `yt_dlp` **langsung di dalam proses Python yang sama** (bukan spawn subprocess CLI) — `extractor_args` mengarahkannya ke `bgutil-provider` (`http://bgutil-provider:4416`) untuk mendapatkan PO-token yang dibutuhkan BotGuard YouTube. Hasilnya: URL CDN `googlevideo.com` langsung (IP-locked ke backend yang me-resolve-nya), MIME type, dan header HTTP yang harus disertakan.
5. **Backend cache hasilnya ke Postgres** (`setCached`) supaya replay/seek lagu yang sama tidak perlu resolve ulang selama 3 jam.
6. **Backend proxy byte-nya ke client** lewat `streamStitched()` — bukan sekadar `pipe()` mentah. Ini bagian paling penting untuk dipahami:
   - **Kenapa tidak `pipe()` langsung ke `googlevideo.com`?** Koneksi long-lived ke upstream kena timeout anti-bot YouTube setelah ~30 detik. Jadi backend memecah pengambilan data jadi **fetch pendek 256KB** (`WINDOW_SIZE_BYTES`) berurutan, lalu "menjahit" (stitch) tiap potongan itu jadi satu stream keluar yang terlihat kontinu ke client.
   - **Kenapa tidak sekadar balikin 206 Partial Content dari window 256KB itu ke request tanpa `Range` (khas Safari)?** Karena itu melanggar spec (client mengira 256KB itu keseluruhan file) — jadi request tanpa `Range` dijawab `200 OK` dengan `Content-Length` = ukuran file asli, sementara *di baliknya* tetap diisi lewat rangkaian fetch 256KB yang sama.
   - **Backpressure**: `writeChunk()` menunggu event `'drain'` sebelum menulis chunk berikutnya, supaya client/koneksi lambat tidak bikin buffer Node menumpuk tanpa batas di RAM.
   - **Caching dua lapis**: `windowCache` (per video+quality, window 256KB terakhir yang di-fetch, hard-capped 60 entri ≈15MB, di-sweep tiap 5 menit) mempercepat chunk-chunk request berikutnya dari client yang sama; `fullBufferCache` menangani kasus langka upstream yang mengabaikan `Range` sama sekali dan mengembalikan file penuh — dibuffer sekali, lalu dipotong manual sesuai yang diminta client.
7. **Disconnect di tengah jalan** ditangani lewat `req.on('close')` — loop `streamStitched` berhenti, tidak terus fetch upstream untuk client yang sudah pergi.

### Diagram ringkas satu request audio

```
<audio src="/api/audio/abc123?quality=high">
        │
        ▼
  nginx (proxy_buffering off — wajib, biar Range/seek gak delay)
        │
        ▼
  backend: routes/audio.ts
        │
        ├─ cache Postgres HIT? ──▶ pakai URL lama
        │
        └─ MISS ──▶ pLimit(1) ──▶ ytdlp-service:8000/resolve
                                       │
                                       ▼
                              yt_dlp.extract_info() (in-process,
                              extractor_args → bgutil-provider utk PO-token)
                                       │
                                       ▼
                              URL googlevideo.com + headers
        │
        ▼
  streamStitched(): fetch 256KB demi 256KB ke googlevideo.com,
  tulis ke client dgn backpressure, cache tiap window
        │
        ▼
  <audio> element menerima byte, browser yang decode & mainkan
```

## 3. Alur Jam (dengerin bareng)

```
Device A: POST /api/jam/create {clientId, initialQueue}
  → roomManager.createRoom() → roomId (in-memory Map, tidak persisten)

Device A & B: GET /api/jam/:roomId/stream?clientId=... (SSE, koneksi tetap terbuka)
  → roomManager.addMember() → broadcast 'presence'
  → keepalive comment tiap 20 detik (cegah proxy/nginx idle-timeout)

Device mana pun: POST /api/jam/:roomId/action {clientId, type, payload}
  → roomManager.applyIntent() → reducer murni (queueReducer.ts)
  → broadcast 'queue' dan/atau 'transport' ke SEMUA member via SSE (termasuk pengirim)

Device close tab/app → req.on('close') di jam.ts
  → removeMember() + clearInterval(keepAlive)

Room idle (0 member) > 5 menit → GC setInterval tiap 60 detik → room dihapus
```

Kontrol simetris penuh: tidak ada state "siapa host" yang membatasi siapa boleh apa. Sinkronisasi posisi antar device sengaja tidak sample-accurate (toleransi drift ~1.5 detik) karena tidak ada mekanisme sinkron clock `AudioContext` lintas device.

## 4. Alur akun & pairing device

```
Boot pertama device → localStorage generate deviceId (crypto.randomUUID())
Setiap request ke backend → Authorization: Bearer <deviceId>
  → server/src/auth/deviceAuth.ts middleware
    → device belum terdaftar? auto-create account + device row (Postgres)
    → device sudah ada? lookup account_id-nya

Pairing device kedua:
  Device A: POST /api/pairing/create → kode 6-karakter short-lived (in-memory, pairingManager.ts)
  Device A: tampilkan kode + QR (encode link ?pair=<kode>, TANPA library scan kamera)
  Device B: buka link lewat kamera OS (bukan in-app) → confirm di ConfirmPairSheet
  Device B: POST /api/pairing/confirm {kode} → server repoint devices.account_id
            milik device B ke account_id milik device A
```

## 5. Alur sinkronisasi library (liked songs & playlist)

```
libraryStore berubah (like lagu / edit playlist)
  → debounce 800ms → src/sync/librarySync.ts
  → PUT /api/library {likedSongs, playlists} (Bearer deviceId)
  → server/src/routes/library.ts → upsert ke library_snapshots (Postgres, whole-snapshot JSONB)

Boot device (baru/reinstall):
  → GET /api/library
  → HANYA hydrate ke localStorage kalau local store masih KOSONG
    (tidak pernah menimpa data yang sudah ada di device — one-way, best-effort)
```

## Kenapa tidak ada ffmpeg di mana pun

Backend **tidak pernah** melakukan transcode/remux. `yt-dlp` cuma dipakai untuk *mendeciphers* URL CDN asli dari YouTube (`extract_info(..., download=False)`); byte audio yang mengalir ke client adalah byte asli dari `googlevideo.com`, diteruskan apa adanya oleh `streamStitched()`. Ini kenapa `server/Dockerfile` sengaja tidak menginstall `ffmpeg` — akan jadi dead weight murni.

---

## Potensi memory leak / proses menggantung

Analisis berdasarkan pembacaan langsung kode saat ini (bukan asumsi):

### Tidak ditemukan: zombie child process klasik
Tidak ada `child_process.spawn`/`exec` di backend Node maupun di `ytdlp-service`. Resolusi `yt-dlp` berjalan **di dalam proses Python `ytdlp-service` yang sama**, memanggil `yt_dlp` sebagai library, bukan menjalankan CLI-nya sebagai proses terpisah. Jadi tidak ada risiko proses `yt-dlp`/`ffmpeg` anak yang "menggantung" tanpa pernah di-reap — arsitektur ini justru sudah menghindari masalah itu dibanding pendekatan spawn-CLI-per-request yang sempat dipakai di iterasi sebelumnya (lihat commit `83c4dff`, migrasi ke microservice always-on).

### Risiko #1 — `fetch()` tanpa timeout ke `ytdlp-service` → **sudah ditambal (2026-09-19)**
[server/src/youtube/stream.ts](./server/src/youtube/stream.ts) sebelumnya memanggil `fetch('http://ytdlp-service:8000/resolve', ...)` **tanpa `AbortSignal`/timeout apa pun**. Kalau `ytdlp-service` atau `bgutil-provider` (Chrome headless-nya) hang, request ini bisa menggantung tanpa batas waktu — dan karena dibungkus limiter concurrency-1, **efeknya jauh lebih besar dari satu request yang gagal**: seluruh antrean resolusi audio di app (untuk *semua* user) ikut macet total di belakangnya.

**Fix**: `resolveAudioUncached()` sekarang mengirim `signal: AbortSignal.timeout(RESOLVE_TIMEOUT_MS)` (25 detik — sengaja di atas `socket_timeout: 20` milik `ytdlp-service` sendiri, biar timeout Python-nya yang biasanya sempat jalan duluan dan balikin error yang jelas; 25 detik ini cuma jaring pengaman kalau itu pun gak sempat). Sekaligus, `pLimit(1)` dari library `p-limit` diganti `PriorityLimiter` custom (concurrency tetap 1, gak nambah beban CPU/RAM e2-micro) yang punya dua jalur antrean:
- **`high`** — lagu yang beneran sedang dimuat/di-crossfade (dipakai `GET /api/audio/:videoId`, termasuk saat `preloadNextTrack()` frontend native-preload lagu berikutnya).
- **`low`** — prefetch resolve-only untuk lagu yang lebih jauh di antrean (`GET /api/audio/:videoId/resolve`), yang cuma warm-up, belum tentu jadi didengar.

Antrean `high` selalu dikuras duluan sebelum `low`. Ini gak bisa "menyela" resolusi yang SUDAH berjalan (cuma urutan antrean, bukan preemption paksa) — tapi itu memang satu-satunya celah yang bisa dibenerin FIFO polos tanpa mengubah batas concurrency.

**Diverifikasi** lewat Docker + curl nyata: 3 resolve `low`-priority ditembak berurutan (mengisi antrean), lalu 1 request `high`-priority ditembak di tengah-tengah saat antrean sudah berisi 2 item `low`. Hasil dari log backend — request `high` yang masuk BELAKANGAN tetap selesai LEBIH DULU (3.6 detik) dibanding salah satu request `low` yang sudah lebih dulu antre (5.6 detik). Build (`tsc`) dan `npm run test` (23 test) tetap bersih.

### Risiko #2 — `fullBufferCache` tanpa hard cap → **sudah ditambal (2026-09-19)**
[server/src/routes/audio.ts](./server/src/routes/audio.ts) — `fullBufferCache` (menyimpan seluruh file audio yang sudah dibuffer, untuk kasus upstream mengabaikan `Range`) punya TTL + sweep berkala (5 menit), tapi sebelumnya **tidak ada batas jumlah entri** seperti `windowCache` di file yang sama. **Fix**: ditambahkan `MAX_FULL_BUFFER_CACHE_ENTRIES = 20` dengan pola eviction insertion-order yang sama seperti `windowCache` (`setCachedBuffer()`).

### Aman: yang lain sudah punya hygiene yang baik
- `windowCache` (audio.ts): hard cap 60 entri + sweep 5 menit. ✅
- SSE Jam (`jam.ts`): `req.on('close')` membersihkan `keepAlive` interval dan menghapus member — tidak ada koneksi SSE yang bocor. ✅
- Room Jam (`roomManager.ts`): GC otomatis untuk room idle >5 menit, `setInterval` di-`unref()`. ✅
- `inFlight` dedup Map (stream.ts): dibersihkan via `.finally()` setiap resolusi selesai, tidak pernah menumpuk. ✅

### Bukan bug kode — trade-off arsitektur
`bgutil-provider` menjalankan **headless Chrome** untuk menghasilkan PO-token yang dibutuhkan BotGuard YouTube. Ini komponen paling boros RAM di seluruh stack (bisa 100–300MB sendirian), berjalan berdampingan dengan Postgres + Node + Python di VM 1GB. Ini bukan sesuatu yang bisa "diperbaiki" dari sisi kode aplikasi — ini konsekuensi langsung dari kebutuhan melewati proteksi anti-bot YouTube. Kalau tekanan RAM makin terasa di masa depan, opsi realistisnya ada di [Enhancement Plan](./PRD.md#enhancement-plan) (evaluasi ulang provider PO-token, atau pisah ke VM lain) — bukan sesuatu yang bisa diatasi lewat perbaikan kode kecil.
