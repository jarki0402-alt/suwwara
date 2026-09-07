# Suwwara

Pemutar musik bebas iklan, ringan, dan smooth — PWA yang bisa dipasang di HP maupun desktop. Arsitektur hybrid: GCP (audio resolve/proxy via `yt-dlp`, akun, library, Jam) + Vercel (pencarian/metadata, stateless) + Postgres (akun & cache audio).

## Struktur proyek

```
suwwara/
├── src/            frontend — React 19 + Vite + TypeScript
│   ├── api/            klien REST (musicClient: search/audio, authClient: akun/library/pairing)
│   ├── auth/            identitas device tanpa password (src/auth/deviceIdentity.ts)
│   ├── sync/            write-through sync library ⇄ server (src/sync/librarySync.ts)
│   ├── audio-engine/   AudioEngine singleton (Web Audio graph, crossfade)
│   ├── media-session/  integrasi lock-screen / notification media controls
│   ├── playback/       orkestrasi queue ⇄ AudioEngine ⇄ MediaSession
│   ├── jam/             client "Jam" (dengerin bareng) — SSE client, aksi antrean yang jam-aware
│   ├── stores/         Zustand stores (player, queue, library, history, settings, ui, jam)
│   ├── recommendation/ mesin rekomendasi & trending berbasis histori lokal
│   ├── lyrics/         parser LRC + sinkronisasi lirik (LRCLIB)
│   ├── views/          layar: home, search, library, queue, now-playing, settings
│   ├── app-shell/      shell aplikasi: bottom nav, mini player
│   ├── components/     komponen reusable (sheet, toast, dll — termasuk JamSheet/PairDeviceSheet)
│   ├── pwa/             registrasi service worker, prompt install, estimasi storage
│   └── sw.ts            service worker (Workbox, injectManifest)
├── server/          backend GCP — Express + TypeScript (audio, akun, library, Jam — butuh proses persisten)
│   └── src/
│       ├── routes/      /api/audio, /api/auth, /api/library, /api/jam (+ search/browse/details/similar/trending, dipertahankan sebagai fallback lokal — lihat nginx.conf)
│       ├── db/           koneksi Postgres + schema (accounts, devices, library_snapshots, audio_cache)
│       ├── auth/         middleware device-id bearer token
│       ├── pairing/      kode pairing QR short-lived (pola sama dengan room code Jam)
│       ├── jam/          state room "Jam" in-memory + reducer antrean (mirror queueStore.ts)
│       └── youtube/     resolusi audio via yt-dlp (cache di Postgres, limiter maks 3 proses bersamaan)
├── vercel/          proyek Vercel terpisah — search/browse/details/similar/trending (stateless, tanpa DB)
│   ├── api/             Vercel Functions (file-based routing)
│   └── lib/              logic YouTube Music, di-port apa adanya dari server/src/youtube/
├── PROGRESS.md      log progres pembangunan aplikasi (baca ini untuk status terkini)
├── Dockerfile       image frontend (build Vite → serve statis via nginx)
├── nginx.conf       nginx: serve static + split proxy (Vercel utk metadata, backend lokal utk sisanya)
├── docker-compose.yml   orkestrasi frontend+backend+postgres buat deploy (GCP e2-micro)
├── server/Dockerfile    image backend (Node + Python/yt-dlp)
├── .env.example     template POSTGRES_PASSWORD (copy ke .env, gitignored)
└── public/icons/    ikon PWA
```

## Menjalankan secara lokal (development)

Proyek ini **hanya dijalankan lewat Docker Compose**, bukan `npm run dev` — backend butuh Postgres + `yt-dlp` yang gak dicoba disediakan lewat dev server terpisah lagi.

```bash
cp .env.example .env    # isi POSTGRES_PASSWORD
docker compose up -d --build
```

- Frontend: `http://localhost:8080` (nginx, serve build statis + proxy `/api/*`)
- Backend langsung: `http://localhost:8787` (dipublish juga ke host — berguna kalau mau expose audio streaming langsung tanpa lewat CDN/proxy di depan, lihat komentar di `docker-compose.yml`)
- Postgres: **tidak** dipublish ke host — hanya bisa diakses `backend` lewat jaringan Docker internal.

Selama development, path pencarian (`/api/search`, `/api/browse`, dst) di `nginx.conf` diarahkan ke Vercel — kalau belum deploy ke Vercel atau lagi kerja offline, ganti sementara ke `proxy_pass http://backend:8787;` (backend masih punya route yang sama sebagai fallback) lalu `docker compose up -d --build` ulang.

Backend image (`node:22-alpine` + `python3`/`yt-dlp`, tanpa ffmpeg karena tidak pernah dipakai — lihat komentar di `server/Dockerfile`) ≈300MB. Frontend image (`nginx:alpine` + hasil build statis) ≈69MB. Postgres image (`postgres:16-alpine`) ≈245MB. Semua multi-stage build di mana relevan, jadi devDependencies/toolchain build gak ikut ke image final.

Untuk deploy ke GCP + Vercel beneran, lihat bagian **Deploy** di bawah.

## Skrip

| Perintah | Fungsi |
|---|---|
| `npm run build` | type-check (`tsc -b`) lalu build produksi frontend |
| `npm run lint` | jalankan Oxlint |
| `npm run test` | jalankan test suite (Vitest) |
| `npm --prefix server run build` | type-check backend |
| `npm --prefix vercel run build` (via `npx tsc --noEmit`) | type-check Vercel functions |

## Stack

- **Frontend**: React 19, TypeScript, Vite, Zustand (state), Workbox (service worker via `vite-plugin-pwa`, strategi `injectManifest`), `qrcode` (render kode pairing sebagai QR)
- **Backend (GCP)**: Express, `yt-dlp` (resolusi & proxy audio, cache di Postgres, dibatasi `p-limit` maks 3 proses bersamaan), `postgres` (klien DB, tanpa ORM), `ytmusic-api`/`youtube-sr` (fallback lokal untuk pencarian & metadata)
- **Search/metadata (Vercel)**: Vercel Functions (Node runtime), `ytmusic-api`/`youtube-sr` — stateless, tanpa akses Postgres
- **Database**: Postgres 16 (akun/device, snapshot library, cache resolve audio) — self-hosted di kontainer yang sama dengan backend, tidak pernah diekspos publik
- **Akun**: tanpa password — device ID acak + pairing lintas device via kode/QR (lihat `src/auth/deviceIdentity.ts`, `server/src/pairing/pairingManager.ts`)
- **Audio**: Web Audio API (dua `<audio>` element paralel untuk crossfade)
- **Lirik**: LRCLIB, parser LRC sendiri

## Deploy

Lihat [PROGRESS.md](./PROGRESS.md) (entri 2026-09-07) untuk alasan arsitektur ini, atau langsung ke panduan langkah-demi-langkah (Vercel + edit VM GCP) yang diberikan di percakapan yang menghasilkan perubahan ini.

## Status pembangunan

Lihat [PROGRESS.md](./PROGRESS.md) untuk log fitur yang sudah selesai, sedang dikerjakan, dan known issues. File itu di-update setiap ada perubahan signifikan pada aplikasi.
