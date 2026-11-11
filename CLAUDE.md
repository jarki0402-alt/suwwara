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
6. **`bgutil-provider` dan plugin pip `bgutil-ytdlp-pot-provider` wajib versi sama** (dikunci di [docker-compose.yml](./docker-compose.yml) dan [server/ytdlp-service/requirements.txt](./server/ytdlp-service/requirements.txt)). Beda versi mematikan token PO diam-diam, lalu YouTube cuma kasih file video 360p yang tetap "jalan" sebagai audio (pernah kejadian berbulan-bulan, ketahuan 2026-11). Cek cepat: `select substring(url from 'itag=([0-9]+)'), count(*) from audio_cache group by 1` harus 140/251, bukan 18.
7. **Jangan install ffmpeg atau dependency native berat lain di image backend** kecuali beneran dipakai. Backend ini sengaja cuma proxy byte URL yang sudah di-resolve `yt-dlp`, gak pernah remux/transcode — lihat komentar di [server/Dockerfile](./server/Dockerfile).
8. **Beri timeout eksplisit ke setiap `fetch()` keluar** (ke `ytdlp-service`, ke `googlevideo.com`, ke API eksternal apa pun). Ini belum konsisten diterapkan di seluruh backend saat ini — lihat bagian "Potensi hang" di [PRD.md](./PRD.md#enhancement-plan) sebelum menambah pemanggilan fetch baru tanpa timeout.
9. **Gaya komentar repo ini: comment yang menjelaskan KENAPA, terutama untuk workaround iOS/WebKit dan trade-off RAM** — bukan menjelaskan APA yang dilakukan kode. Ikuti gaya ini kalau nulis workaround serupa (lihat hampir semua komentar di `AudioEngine.ts` dan `audio.ts` sebagai referensi gaya).
10. **TypeScript strict** di frontend maupun backend — hindari `any` kecuali beneran perlu (ada satu kasus di `stream.ts` buat parsing response JSON generik, itu batas toleransinya, jangan jadi kebiasaan).
11. **Dilarang em dash (`—`, U+2014) di teks apa pun yang bisa tampil di aplikasi**: halaman login/landing, menu, toast, pesan error, konsol admin, pesan dari server, `index.html`, manifest PWA. Pakai koma, titik, titik dua, atau ` · ` sebagai pemisah. Ini juga berlaku untuk teks yang di-generate (AI, template, salin-tempel). Dijaga otomatis oleh [tests/text/noEmDash.test.ts](./tests/text/noEmDash.test.ts) (memindai semua string, template, dan teks JSX di `src/` dan `server/src/`, termasuk bentuk `\u2014` dan `&mdash;`), jadi `npm run test` gagal kalau ada yang menambahkannya. Teks dari luar (judul YouTube, nama artis/album, lirik, bio Wikipedia) dibersihkan saat masuk lewat `parseJsonWithoutEmDash` di [src/utils/noEmDash.ts](./src/utils/noEmDash.ts). Komentar kode tidak terkena aturan ini karena tidak pernah tampil.
12. **Teks yang tampil di app wajib lewat sistem bahasa** ([src/i18n/i18n.ts](./src/i18n/i18n.ts)): tulis Indonesia sebagai kunci, `const t = useT()` di komponen, `t()` di luar React, `msg()` untuk label di konstanta modul, placeholder `{name}` (jangan `${}` di dalam `t()`), lalu tambahkan Inggrisnya di `src/i18n/en/<area>.ts`. [tests/i18n/translations.test.ts](./tests/i18n/translations.test.ts) gagal kalau ada teks JSX mentah atau kunci tanpa Inggris. Pengecualian: konsol admin (`src/views/admin`) tetap Indonesia saja.

## Environment variables

| Variabel | Dipakai di | Keterangan |
|---|---|---|
| `POSTGRES_PASSWORD` | `.env` (gitignored, copy dari `.env.example`) | Password Postgres, dipakai `postgres` & `backend` service |
| `PORT` | backend | Default `8787` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `.env` → backend | Admin (konsol pengelolaan, tanpa pemutar) dibuat saat boot pertama (login **wajib** untuk semua). Sandi admin min. 12 karakter; kosong/terlalu pendek → dibuat acak dan dicetak sekali di `docker compose logs backend`; wajib diganti saat pertama masuk |
| `EGRESS_RP_PER_GIB` / `EGRESS_OVERHEAD` | `.env` → backend | Perkiraan tagihan GCP di dashboard admin ([server/src/metrics/billing.ts](./server/src/metrics/billing.ts)). Satu-satunya biaya VM ini adalah data keluar ke Cloudflare (*Carrier Peering*, **tidak** termasuk jatah gratis 200 GiB): ±Rp 1.450/GiB, dan tagihan ±8% di atas byte yang dihitung server (Okt 2026: 4,22 vs 3,92 GiB). Bawaan 1450 dan 1.08; kalibrasi ulang dari CSV billing kalau kurs/pola berubah. VM e2-micro, disk 30 GB, dan IP publik Rp 0 (free tier) |
| `VIDEO_ENABLED` | `.env` → backend | `false` mematikan video musik (tombol Lagu \| Video tidak muncul, `/api/video` menolak). Bawaan nyala. Lihat [server/src/routes/video.ts](./server/src/routes/video.ts) |
| `PGHOST`/`PGPORT`/`PGDATABASE`/`PGUSER`/`PGPASSWORD` | backend | Di-set di `docker-compose.yml`, jangan diganti jadi satu connection string (lihat aturan #5 di atas) |

## Struktur singkat

Lihat [README.md](./README.md) untuk pohon direktori lengkap. Ringkasnya: `src/` (frontend React), `server/` (backend Express + Python `ytdlp-service`), `vercel/` (proyek terpisah, tidak aktif dipakai saat ini), `docker-compose.yml` (orkestrasi 5 service: `frontend`, `backend`, `ytdlp-service`, `bgutil-provider`, `postgres`).
