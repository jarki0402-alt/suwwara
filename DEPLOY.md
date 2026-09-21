# DEPLOY.md — Deploy Suwwara ke VPS (Docker Compose + Cloudflare Tunnel)

Panduan ini untuk deploy pertama versi **dengan login wajib** (dan untuk deploy biasa sesudahnya). Semua perintah dijalankan di VPS lewat SSH, di folder project, kecuali disebut lain.

> Ringkas: cadangkan database → `git pull` → isi `.env` → build → recreate → periksa → Cloudflare → masuk pertama kali.

---

## 0. Sebelum mulai (2 menit)

```bash
cd ~/suwwara              # ganti dengan folder project-mu
git status                # harus bersih (tidak ada perubahan lokal yang belum di-commit)
df -h /                   # sisa disk minimal ±3 GB (build Docker butuh ruang)
free -h                   # catat RAM/swap
docker compose ps         # semua service Up
```

Kalau `git status` menunjukkan perubahan yang tidak kamu kenali, jangan lanjut — simpan dulu (`git stash`) atau tanya.

## 1. Cadangkan database (WAJIB, sekali sebelum deploy ini)

Deploy ini menambah tabel baru (aman, tidak menghapus apa pun), tapi cadangan murah dan menyelamatkan kalau ada yang salah.

```bash
mkdir -p ~/backup-sebelum-login
docker compose exec -T postgres pg_dump -U suwwara suwwara | gzip > ~/backup-sebelum-login/suwwara-$(date +%F-%H%M).sql.gz
ls -lh ~/backup-sebelum-login/            # ukurannya harus > 0 (biasanya ratusan KB)
gzip -t ~/backup-sebelum-login/*.sql.gz && echo "cadangan valid"
```

## 2. Ambil kode terbaru

```bash
git pull
git log --oneline -3      # commit teratas harus "feat(playback): opening or refreshing the app no longer..." atau yang lebih baru
```

## 3. Atur admin di `.env`

Login wajib untuk semua, jadi harus ada admin pertama. **Akun admin hanya untuk mengelola aplikasi** (konsol admin: pengguna, bandwidth, server, keamanan) — ia **tidak memutar musik**. Untuk mendengarkan, kamu akan membuat akun pengguna biasa sendiri di langkah 8. Buka `.env`:

```bash
nano .env
```

Tambahkan dua baris (ganti nilainya):

```
ADMIN_USERNAME=admin
ADMIN_PASSWORD=isi-sandi-kuat-minimal-12-karakter
```

Aturan penulisan supaya tidak salah tafsir oleh Docker Compose:
- Tanpa spasi di sekitar `=`, tanpa tanda kutip.
- Sandi admin **minimal 12 karakter** (kalau lebih pendek, diabaikan dan sandi acak dicetak di log). Hindari karakter `$`, `#`, `"`, `'`, `\` (pakai huruf, angka, `-`, `_`, `.`).
- Nama pengguna: 3–32 karakter, huruf kecil/angka/`.`/`-`/`_`.

Boleh juga **mengosongkan** `ADMIN_PASSWORD=`: sandi acak dibuat dan dicetak **sekali** di log (langkah 6), lalu wajib diganti (12+ karakter) saat pertama masuk.

Simpan: `Ctrl+O`, `Enter`, `Ctrl+X`. Admin hanya dibuat **sekali**, saat boot pertama ketika belum ada pengguna; mengubah dua baris ini setelahnya tidak membuat admin baru. Akun admin dibuat **kosong** — playlist lamamu tidak dihapus atau dipindahkan; ia menunggu di "akun lama" sampai kamu menautkannya (langkah 8).

## 4. Build (satu per satu — VM 1 GB)

Build paralel bisa kehabisan RAM. Bangun berurutan, lalu jalankan:

```bash
docker compose build backend
docker compose build frontend
```

Perkiraan waktu: 3–10 menit di e2-micro. Kalau gagal dengan pesan seperti `signal: killed`, `no such job`, atau proses berhenti tiba-tiba, itu kehabisan memori. Tambah swap **sementara**, ulangi build, lalu lepas lagi:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
free -h                                    # swap 2 GB muncul
docker compose build backend && docker compose build frontend
sudo swapoff /swapfile && sudo rm /swapfile   # setelah selesai
```

## 5. Jalankan ulang backend dan frontend

`--force-recreate` wajib (compose tidak selalu mengganti container hanya karena image berubah):

```bash
docker compose up -d --force-recreate backend frontend
docker compose ps
```

Yang harus terlihat: `backend`, `frontend`, `postgres` **Up (healthy)**; `ytdlp-service` dan `bgutil-provider` tetap Up (tidak disentuh). Port backend sekarang `127.0.0.1:8787->8787`, bukan `0.0.0.0` (memang disengaja).

## 6. Periksa dari dalam VPS

```bash
# a) Admin dibuat? (muncul hanya pada boot pertama dengan login)
docker compose logs backend | grep -E "\[auth\]|listening"
#    Diharapkan:  [auth] Admin "admin" created from ADMIN_USERNAME / ADMIN_PASSWORD.
#    (atau, bila sandi dikosongkan:  ... Temporary password (shown once ...): xxxxxxxxxxxx  → CATAT sekarang)

# b) Gerbang aktif: tanpa sesi harus 401
curl -s -o /dev/null -w "API tanpa login  : %{http_code} (harus 401)\n" http://localhost:8787/api/trending
curl -s -o /dev/null -w "Audio tanpa login: %{http_code} (harus 401)\n" http://localhost:8787/api/audio/Bl0Gtp5FMd4

# c) Header cache benar
curl -sI http://localhost:8080/sw.js | grep -iE "cache-control|x-frame|nosniff"
#    Diharapkan: Cache-Control: no-store, must-revalidate  +  X-Frame-Options: DENY  +  X-Content-Type-Options: nosniff

# d) Versi build yang sekarang dilayani
curl -s http://localhost:8080/version.json
```

Kalau (a) tidak menampilkan baris `[auth]`, lihat `docker compose logs backend | tail -40`. Bila tertulis `error`, kirim ke saya.

## 7. Cloudflare (dashboard, domain `suwwara.fajarrizky.my.id`)

Perhatikan ejaan host: **`fajarrizky`** (pakai "z").

1. **Purge cache** (agar tak ada `sw.js` lama yang tersisa): Caching → Configuration → Purge Cache → **Custom Purge** → pilih **URL**, isi dua baris:
   ```
   https://suwwara.fajarrizky.my.id/sw.js
   https://suwwara.fajarrizky.my.id/
   ```
2. **Browser Cache TTL** → pilih **Respect Existing Headers** (Caching → Configuration).
3. **Rate limiting** untuk login (lapisan kedua di luar pembatas aplikasi): Security → WAF → Rate limiting rules → Create rule. Ekspresi:
   `(http.host eq "suwwara.fajarrizky.my.id" and http.request.uri.path eq "/api/auth/login" and http.request.method eq "POST")`
   Batasi per IP; angka mengikuti opsi paket-mu (mis. 5–10 permintaan per rentang terpendek yang ditawarkan), aksi Block.
4. Cek dari laptopmu (bukan VPS):
   ```bash
   for i in $(seq 1 20); do curl -s -o /dev/null -D - https://suwwara.fajarrizky.my.id/sw.js | grep -iE "cf-cache-status|^age|last-modified" | tr '\n' ' '; echo; done
   ```
   Semua baris harus `BYPASS`/`DYNAMIC` (tidak ada `HIT`) dan `last-modified` sama.

## 8. Masuk pertama kali dan membuat akun musikmu

**Admin dan pendengar adalah dua akun.** Akun admin membuka konsol pengelolaan; akun pengguna biasa membuka aplikasi musik.

1. Buka `https://suwwara.fajarrizky.my.id` di laptop (`Cmd/Ctrl+Shift+R`). Harus muncul **landing page** dengan formulir Masuk.
2. Masuk dengan `ADMIN_USERNAME` / `ADMIN_PASSWORD`. Kamu masuk ke **konsol admin** (sidebar: Ringkasan, Pengguna, Pemakaian, Sistem, Keamanan, Akun) — tanpa pemutar. Bila sandi sementara, kamu diminta membuat sandi baru (12+ karakter).
3. **Buat akun musikmu** — tab **Pengguna** → *Tambah pengguna*:
   - Isi nama, mis. `fajar` (jangan centang **Admin**).
   - Di **"Pakai pustaka dari akun lama"** pilih baris yang berisi playlist-mu (tertulis jumlah lagu disukai, jumlah playlist, dan nama beberapa playlist). Kalau ada beberapa baris, yang berisi paling banyak biasanya milikmu; nama playlist membantu memastikan.
   - Klik **Buat**, lalu **salin sandi sementara** (tampil sekali).
   - Lewatkan pilihan pustaka lama dan akunmu akan kosong — data lama tidak hilang, ia tetap menunggu di daftar itu dan bisa ditautkan ke akun lain yang kamu buat kemudian (selama belum ada yang mengklaimnya).
4. Di tab **Akun** klik **Keluar**, lalu masuk dengan `fajar` dan sandi sementara tadi. Kamu diminta membuat sandi baru (8+ karakter), lalu masuk ke **aplikasi musik**.
5. Periksa: playlist dan lagu disukai-mu **ada**, lagu berbunyi, Pengaturan → **Akun** tampil (tanpa baris admin).
6. Kembali ke akun admin, buka **Keamanan** → lihat baris "Masuk". Kolom IP harus IP-mu yang sebenarnya. Kalau yang tampil `172.x`/`10.x` (IP tunnel), beri tahu saya (rentang `geo` di `nginx.conf` perlu disesuaikan).
7. DevTools → Application → Cookies: `suwwara_session` bertanda `HttpOnly` dan `Secure` (bila `Secure` tak ada, tetap berfungsi, tapi kabari saya). Cookie admin berumur 7 hari, cookie pengguna biasa 90 hari.

## 9. Perangkat lain (HP/PWA, laptop lain)

- Buka/refresh aplikasi → akan tampil landing → masuk dengan **akun musikmu (`fajar`), bukan admin**. Playlist di perangkat itu digabung ke akun; Beranda menjadi sama di semua perangkat; panel **Perangkat** otomatis menampilkan perangkat lain (tanpa QR, bisa butuh sampai 1 menit).
- Kalau perangkat masih menampilkan **tampilan lama** (tanpa landing) atau muncul error: tutup aplikasi sepenuhnya lalu buka lagi. Bila masih lama: desktop → DevTools → Application → **Clear site data**; iPhone → hapus ikon PWA dari layar utama, buka situs di Safari, lalu Add to Home Screen lagi; Android → Info Aplikasi → Penyimpanan → Hapus data.

## 10. Tambah pengguna

Masuk sebagai admin → konsol → **Pengguna** → isi nama → **Buat**. Sandi sementara tampil **sekali**; salin dan kirim ke orangnya (mereka wajib menggantinya saat pertama masuk). Lupa sandi → tombol **Reset sandi** di kartu pengguna itu.

## 11. Cadangan rutin

```bash
mkdir -p backups
./scripts/backup-db.sh                       # uji sekali; harus mencetak "wrote backups/suwwara-....sql.gz"
crontab -e                                   # tambahkan baris di bawah, simpan
```
```
15 3 * * * cd /home/USERMU/suwwara && ./scripts/backup-db.sh >> backups/backup.log 2>&1
```
Salin cadangan juga ke **luar VM** (bucket/disk lain): cadangan yang hanya ada di VM ikut hilang bersama VM.

Restore (mengganti data saat ini):
```bash
gunzip -c backups/suwwara-TANGGAL.sql.gz | docker compose exec -T postgres psql -U suwwara -d suwwara
```

## 12. Firewall GCP (menutup akses langsung)

Tunnel Cloudflare hanya membuat koneksi **keluar**, jadi port aplikasi tak perlu dibuka ke internet.

```bash
gcloud compute firewall-rules list --format="table(name,direction,sourceRanges.list(),allowed[].map().firewall_rule().list())"
```
Hapus atau batasi aturan yang mengizinkan `tcp:8787` dan `tcp:8080` dari `0.0.0.0/0` (biarkan SSH `tcp:22`). Bila `cloudflared` berjalan di VM yang sama dan menyambung ke `localhost:8080`, menutup 8080 dari luar aman. Uji dari laptop (harus **timeout**):
```bash
curl -m 5 http://IP_VM:8787/ ; curl -m 5 http://IP_VM:8080/
```

## Pulihkan akses admin (lupa sandi)

Dari VPS:
```bash
./scripts/reset-admin-password.sh            # untuk user "admin"; atau: ./scripts/reset-admin-password.sh namamu
```
Mencetak sandi sementara sekali; semua perangkat pengguna itu dikeluarkan dan wajib memilih sandi baru.

## Rollback (kalau perlu kembali)

```bash
git log --oneline | head                     # cari commit sebelum login
git checkout 0f57709                         # versi terakhir SEBELUM login (fitur cache + volume sudah ada)
docker compose build backend && docker compose build frontend
docker compose up -d --force-recreate backend frontend
```
Tabel baru (`users`, `sessions`, `profiles`, dst.) tidak mengganggu versi lama; tidak perlu dihapus. Bila data rusak, restore cadangan langkah 1. Setelah selesai, kembali ke terbaru dengan `git checkout main`.

## Deploy biasa berikutnya

```bash
git pull
docker compose build backend && docker compose build frontend   # hanya yang berubah bila mau
docker compose up -d --force-recreate backend frontend
docker compose ps && docker compose logs backend | tail -20
```

## Masalah umum

| Gejala | Penyebab / tindakan |
|---|---|
| Admin tidak bisa memutar musik | Memang begitu: admin hanya mengelola. Masuk dengan akun pengguna biasa (langkah 8) |
| Landing tak muncul di perangkat, tampilan lama | Bundel lama masih di-cache: langkah 9 (tutup-buka, Clear site data). Pastikan purge `sw.js` (langkah 7) |
| "Layanan sedang tidak tersedia" saat masuk | Backend/database belum siap atau mati: `docker compose ps`, `docker compose logs backend | tail -40` |
| "Terlalu banyak percobaan" | 5 kali salah sandi → terkunci 15 menit (per IP+pengguna). Admin bisa membukanya di Dashboard → Keamanan → Buka, atau restart backend |
| Akun musik kosong padahal punya playlist lama | Playlist lama masih di "akun lama": konsol → Pengguna, buat/ulangi dengan pilihan pustaka lama (akun yang sudah dibuat kosong bisa dihapus dan dibuat ulang) |
| Audio tak berbunyi setelah masuk | Cek cookie `suwwara_session` ada; `docker compose logs backend | grep audio | tail` |
| Semua pengunjung tampak dari satu IP di log Keamanan | Sumber tunnel bukan IP privat: tambahkan rentangnya di blok `geo` `nginx.conf`, rebuild frontend |
| Build gagal / dibunuh | Kehabisan RAM: swap sementara (langkah 4) |
