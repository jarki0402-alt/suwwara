# Suwwara

Pemutar musik bebas iklan, ringan, dan smooth — PWA yang bisa dipasang di HP maupun desktop, streaming audio dari YouTube lewat backend sendiri.

## Struktur proyek

```
suwwara/
├── src/            frontend — React 19 + Vite + TypeScript
│   ├── api/            klien REST ke backend (search, details, audio URL)
│   ├── audio-engine/   AudioEngine singleton (Web Audio graph, crossfade)
│   ├── media-session/  integrasi lock-screen / notification media controls
│   ├── playback/       orkestrasi queue ⇄ AudioEngine ⇄ MediaSession
│   ├── jam/             client "Jam" (dengerin bareng) — WS/SSE client, aksi antrean yang jam-aware
│   ├── stores/         Zustand stores (player, queue, library, history, settings, ui, jam)
│   ├── recommendation/ mesin rekomendasi & trending berbasis histori lokal
│   ├── lyrics/         parser LRC + sinkronisasi lirik (LRCLIB)
│   ├── views/          layar: home, search, library, queue, now-playing, settings
│   ├── app-shell/      shell aplikasi: bottom nav, mini player
│   ├── components/     komponen reusable (sheet, toast, dll — termasuk JamSheet/JoinJamSheet)
│   ├── pwa/             registrasi service worker, prompt install, estimasi storage
│   └── sw.ts            service worker (Workbox, injectManifest)
├── server/          backend — Express + TypeScript
│   └── src/
│       ├── routes/      /api/search, /api/details, /api/audio, /api/trending, /api/similar, /api/jam
│       ├── jam/          state room "Jam" in-memory + reducer antrean (mirror queueStore.ts)
│       └── youtube/     resolusi audio via yt-dlp, pencarian via ytmusic-api/youtube-sr
├── PROGRESS.md      log progres pembangunan aplikasi (baca ini untuk status terkini)
├── Dockerfile       image frontend (build Vite → serve statis via nginx)
├── nginx.conf       nginx: serve static + proxy /api/* ke container backend
├── docker-compose.yml   orkestrasi frontend+backend buat deploy (mis. VPS)
├── server/Dockerfile    image backend (Node + Python/yt-dlp)
└── public/icons/    ikon PWA
```

## Menjalankan secara lokal (development)

Backend dan frontend berjalan sebagai dua proses terpisah, dengan hot-reload.

```bash
# Terminal 1 — backend (port 8787)
cd server
npm install
npm run dev

# Terminal 2 — frontend (port 5173, proxy /api ke backend)
npm install
npm run dev
```

Backend butuh `yt-dlp` terpasang di PATH (dipakai untuk resolusi URL audio dari YouTube).

Frontend lain di jaringan Wi-Fi yang sama (misalnya HP) bisa mengakses lewat IP LAN mesin dev karena Vite di-bind ke semua interface dan `/api/*` di-proxy ke backend lokal — lihat `vite.config.ts`.

## Menjalankan lewat Docker (mendekati produksi / buat deploy)

```bash
docker compose build
docker compose up -d
```

- Frontend: `http://localhost:8080` (nginx, serve build statis + proxy `/api/*` ke backend)
- Backend langsung: `http://localhost:8787` (dipublish juga ke host — berguna kalau mau expose audio streaming langsung tanpa lewat CDN/proxy di depan, lihat komentar di `docker-compose.yml`)

Backend image (`node:22-alpine` + `python3`/`yt-dlp`, tanpa ffmpeg karena tidak pernah dipakai — lihat komentar di `server/Dockerfile`) ≈300MB. Frontend image (`nginx:alpine` + hasil build statis) ≈69MB. Dua-duanya multi-stage build, jadi devDependencies/toolchain build gak ikut ke image final.

Cocok langsung dipakai buat deploy ke VPS mana pun yang bisa jalanin Docker (lihat [PROGRESS.md](./PROGRESS.md) buat diskusi opsi hosting) — tinggal `git pull` + `docker compose up -d --build` di server-nya.

## Skrip

| Perintah | Fungsi |
|---|---|
| `npm run dev` | jalankan Vite dev server |
| `npm run build` | type-check (`tsc -b`) lalu build produksi |
| `npm run lint` | jalankan Oxlint |
| `npm run test` | jalankan test suite (Vitest) |

## Stack

- **Frontend**: React 19, TypeScript, Vite, Zustand (state), Workbox (service worker via `vite-plugin-pwa`, strategi `injectManifest`)
- **Backend**: Express, `yt-dlp` (resolusi & proxy audio), `ytmusic-api`/`youtube-sr` (pencarian & metadata)
- **Audio**: Web Audio API (dua `<audio>` element paralel untuk crossfade)
- **Lirik**: LRCLIB, parser LRC sendiri

## Status pembangunan

Lihat [PROGRESS.md](./PROGRESS.md) untuk log fitur yang sudah selesai, sedang dikerjakan, dan known issues. File itu di-update setiap ada perubahan signifikan pada aplikasi.
