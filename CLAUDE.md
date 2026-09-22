# CLAUDE.md — Panduan Dev Environment Suwwara

Panduan ini buat siapa pun (manusia atau AI) yang mau kerja di codebase ini. Untuk status fitur & log perubahan, lihat [PROGRESS.md](./PROGRESS.md). Untuk peta fitur & rencana ke depan, lihat [PRD.md](./PRD.md). Untuk alur data teknis, lihat [ARCHITECTURE.md](./ARCHITECTURE.md). Untuk cara deploy ke VPS, lihat [DEPLOY.md](./DEPLOY.md).

## Constraint paling penting: VM 1GB RAM

Semua keputusan teknis di project ini — cara caching, cara streaming, concurrency limit — ada di bawah bayang-bayang satu fakta: ini jalan di GCP e2-micro (2 vCPU, **1GB RAM**), dan salah satu container-nya (`bgutil-provider`) menjalankan **headless Chrome**. Chrome sendirian biasanya makan 100–300MB. Sisa RAM harus dibagi ke Postgres, Node/Express, Python/FastAPI, dan nginx. **Jangan tambah dependency atau proses baru tanpa mikir dampaknya ke RAM.**

## Menjalankan project

**Cuma lewat Docker Compose** — bukan `npm run dev` buat full-stack. Backend butuh Postgres + `yt-dlp` service + BotGuard provider yang gak realistis dijalankan manual satu-satu.

```bash
cp .env.example .env    # isi POSTGRES_PASSWORD
docker compose up -d --build
```

- Frontend: `http://localhost:8080` (nginx, static build + proxy `/api/*`)
- Backend langsung: `http://localhost:8787` (dipublish ke host juga — buat bypass proxy kalau perlu, lihat komentar di [docker-compose.yml](./docker-compose.yml))
- Postgres: **tidak** dipublish ke host, cuma bisa diakses dari `backend` lewat jaringan Docker internal

**Gotcha operasional yang sudah kejadian & dicatat**: `docker compose up -d --build` **tidak otomatis** recreate container `backend` kalau cuma image-nya yang berubah (bukan config compose-nya). Kalau habis ubah kode backend terus jalanin ulang tapi perubahan gak kerasa, pakai:

```bash
docker compose up -d --build --force-recreate backend
```

Cek log tiap service kalau ada yang aneh:

```bash
docker compose logs -f backend
docker compose logs -f ytdlp-service
docker compose logs -f bgutil-provider
```

### Mode search/browse offline

`nginx.conf` saat ini mengarahkan `/api/*` ke `backend` lokal (bukan Vercel — sempat dicoba pisah ke Vercel lalu **di-revert**, lihat commit `2faa123`). Jadi search/browse/trending/similar sudah jalan penuh lewat backend lokal tanpa perlu setup Vercel apa pun untuk dev sehari-hari. Folder `vercel/` masih ada di repo (disimpan buat opsi masa depan), tapi tidak aktif dipakai production saat ini.

## Build, lint, test

| Perintah | Fungsi |
|---|---|
| `npm run build` | type-check (`tsc -b`) lalu build produksi frontend |
| `npm run lint` | jalankan Oxlint ([.oxlintrc.json](./.oxlintrc.json)) |
| `npm run test` | jalankan test suite (Vitest, lihat [tests/](./tests/)) |
| `npm --prefix server run build` | type-check backend (`tsc`, tanpa emit ke luar `dist/`) |
| `npm --prefix vercel run build` | type-check proyek Vercel (tidak dipakai production saat ini) |

Jalankan `npm run build` + `npm run test` sebelum menganggap perubahan frontend selesai. Jalankan `npm --prefix server run build` sebelum menganggap perubahan backend selesai — lalu **selalu tes lewat Docker** (`docker compose up -d --build`), bukan cuma percaya type-check, karena bug-bug paling parah di project ini (audio putus di detik 30, dsb.) cuma kelihatan pas jalan beneran di container/device asli.

Tidak ada CI otomatis terdeteksi di repo ini — verifikasi manual (Docker + curl/Playwright/device asli) adalah jalan satu-satunya sejauh ini.

## Aturan kode — spesifik biar efisien di RAM 1GB

1. **Setiap cache in-memory wajib punya batas & pembersihan**, bukan cuma TTL pasif. Contoh yang harus dicontoh: [server/src/routes/audio.ts](./server/src/routes/audio.ts) — `chunkCache` punya hard cap (`MAX_CHUNK_CACHE_ENTRIES`, 160 × 256KB = 40MB) + sweep berkala (`setInterval(..., 5 * 60 * 1000).unref()`); begitu juga `hotCache` di [stream.ts](./server/src/youtube/stream.ts). Jangan bikin `Map` baru yang cuma dicek TTL-nya secara lazy tanpa hard cap kalau key-nya bisa datang dari input yang gak terbatas (video ID, dll).
2. **Jangan buffer seluruh response ke memori kalau bisa di-stream.** Proxy audio ngambil dari YouTube per chunk tetap 256KB (`CHUNK_SIZE`, jadi `arrayBuffer()` per chunk itu bounded) dan nulis ke client pakai `writeChunk()` yang nunggu event `'drain'` — ini pola wajib buat data besar apa pun yang lewat backend ini. Jangan `await response.arrayBuffer()` atau `Buffer.concat` seluruh *file/body* kecuali kepepet (dan kalau kepepet, kasih hard cap ukurannya, seperti `MAX_FULL_BODY_BYTES`).
3. **Batasi concurrency untuk apa pun yang berat CPU/RAM.** `resolveAudio()` di [server/src/youtube/stream.ts](./server/src/youtube/stream.ts) pakai `PriorityLimiter(1)` ([priorityLimiter.ts](./server/src/youtube/priorityLimiter.ts)) khusus buat panggilan ke `ytdlp-service` — jangan naikkan angka ini tanpa alasan kuat, sudah pernah dicoba 3 dan bikin resolusi audio molor dari 3 detik jadi 10+ detik gara-gara context switching di 1 vCPU. Yang bikin "loading" lama ternyata bukan satu resolve-nya (~1,6 detik kalau sendirian) tapi **antre di belakang resolve lain**: makanya antrean itu punya lane high/low, membuang task yang sudah ditinggal kliennya, dan menaikkan prioritas task low yang tiba-tiba diklik.
4. **Timer background wajib `.unref()`** supaya gak menahan proses Node hidup saat graceful shutdown atau bikin test hang.
5. **Koneksi Postgres pakai field diskrit (`PGHOST`/`PGUSER`/dst), bukan satu connection-string URL** — password yang mengandung karakter reserved URL (`#`, `%`, `@`) pernah diam-diam merusak parsing. Lihat komentar di [server/src/db/client.ts](./server/src/db/client.ts).
6. **Jangan install ffmpeg atau dependency native berat lain di image backend** kecuali beneran dipakai. Backend ini sengaja cuma proxy byte URL yang sudah di-resolve `yt-dlp`, gak pernah remux/transcode — lihat komentar di [server/Dockerfile](./server/Dockerfile).
7. **Beri timeout eksplisit ke setiap `fetch()` keluar** (ke `ytdlp-service`, ke `googlevideo.com`, ke API eksternal apa pun). Ini belum konsisten diterapkan di seluruh backend saat ini — lihat bagian "Potensi hang" di [PRD.md](./PRD.md#enhancement-plan) sebelum menambah pemanggilan fetch baru tanpa timeout.
8. **Gaya komentar repo ini: comment yang menjelaskan KENAPA, terutama untuk workaround iOS/WebKit dan trade-off RAM** — bukan menjelaskan APA yang dilakukan kode. Ikuti gaya ini kalau nulis workaround serupa (lihat hampir semua komentar di `AudioEngine.ts` dan `audio.ts` sebagai referensi gaya).
9. **TypeScript strict** di frontend maupun backend — hindari `any` kecuali beneran perlu (ada satu kasus di `stream.ts` buat parsing response JSON generik, itu batas toleransinya, jangan jadi kebiasaan).

## Environment variables

| Variabel | Dipakai di | Keterangan |
|---|---|---|
| `POSTGRES_PASSWORD` | `.env` (gitignored, copy dari `.env.example`) | Password Postgres, dipakai `postgres` & `backend` service |
| `PORT` | backend | Default `8787` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `.env` → backend | Admin (konsol pengelolaan, tanpa pemutar) dibuat saat boot pertama (login **wajib** untuk semua). Sandi admin min. 12 karakter; kosong/terlalu pendek → dibuat acak dan dicetak sekali di `docker compose logs backend`; wajib diganti saat pertama masuk |
| `BANDWIDTH_QUOTA_GB` | `.env` → backend | Angka patokan (bukan batas yang ditegakkan) buat kartu "Kuota bulan ini" di dashboard admin. Cuma menghitung audio yang lewat backend ini, jadi cuma perkiraan — cek kuota/harga egress asli di cloud-mu. Bawaan 200 kalau tak diisi |
| `PGHOST`/`PGPORT`/`PGDATABASE`/`PGUSER`/`PGPASSWORD` | backend | Di-set di `docker-compose.yml`, jangan diganti jadi satu connection string (lihat aturan #5 di atas) |

## Struktur singkat

Lihat [README.md](./README.md) untuk pohon direktori lengkap. Ringkasnya: `src/` (frontend React), `server/` (backend Express + Python `ytdlp-service`), `vercel/` (proyek terpisah, tidak aktif dipakai saat ini), `docker-compose.yml` (orkestrasi 5 service: `frontend`, `backend`, `ytdlp-service`, `bgutil-provider`, `postgres`).
