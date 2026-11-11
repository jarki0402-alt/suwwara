-- KHUSUS LAPTOP. Mengisi konsol admin dengan data contoh (8 pengguna "demo-...", 90 hari pemakaian per jam, 14 hari
-- riwayat Sistem) supaya tampilan Pemakaian / Laporan / Sistem bisa dilihat sebelum ada data sungguhan.
-- JANGAN dijalankan di server: tanpa -v i_am_local=1 script ini menolak.
--
--   docker compose exec -T postgres psql -U suwwara -d suwwara -v i_am_local=1 < scripts/admin-demo-seed.sql
--
-- Bersihkan lagi dengan scripts/admin-demo-clear.sql. Akun demo tidak bisa dipakai masuk (sandinya bukan hash sah).

\if :{?i_am_local}
\else
  \echo 'Ditolak: ini data contoh untuk laptop. Jalankan dengan -v i_am_local=1, dan jangan di server.'
  \quit
\endif

begin;
select setseed(0.42);

create temp table demo_profile (name text, intensity real, podcast real, video real, offline real, ua text) on commit drop;
insert into demo_profile values
  ('demo-andi',   1.5, 0.10, 0.10, 0.55, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'),
  ('demo-sari',   1.1, 0.60, 0.00, 0.35, 'Mozilla/5.0 (Linux; Android 14; SM-A155F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'),
  ('demo-budi',   0.8, 0.00, 0.30, 0.10, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'),
  ('demo-rina',   1.3, 0.25, 0.05, 0.70, 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1'),
  ('demo-joko',   0.5, 0.80, 0.00, 0.20, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15'),
  ('demo-maya',   0.9, 0.15, 0.20, 0.45, 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'),
  ('demo-dewi',   0.3, 0.00, 0.00, 0.30, 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'),
  ('demo-fatur',  1.0, 0.35, 0.15, 0.50, 'Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1');

insert into accounts (id, created_at) select name, now() - interval '120 days' from demo_profile on conflict do nothing;
insert into users (account_id, username, password_hash, role, created_at, last_login_at)
  select name, name, '!demo-tidak-bisa-masuk', 'user', now() - interval '120 days', now() - random() * interval '3 days' from demo_profile
  on conflict do nothing;
insert into sessions (token_hash, account_id, user_agent, ip, created_at, last_seen_at, expires_at)
  select md5('demo-session-' || name), name, ua, '10.0.0.' || (row_number() over ())::text, now() - interval '20 days', now() - random() * interval '30 hours', now() + interval '30 days'
  from demo_profile on conflict do nothing;

-- Every hour of the last 90 days, weighted like real listening: evenings most, commute and lunch some, nights little,
-- weekends a bit more. Each person has their own appetite, podcast/video taste and share played from the phone.
create temp table demo_hours on commit drop as
select p.*, g.hour, random() as r1, random() as r2, random() as r3,
  (case when t.lh between 19 and 22 then 1.0 when t.lh in (18, 23) then 0.7 when t.lh between 7 and 8 then 0.55
        when t.lh between 12 and 13 then 0.5 when t.lh between 9 and 17 then 0.28 when t.lh between 0 and 1 then 0.22 else 0.03 end)
  * (case when t.dow >= 6 then 1.25 else 1 end) * p.intensity as w
from demo_profile p
cross join generate_series(date_trunc('hour', now()) - interval '89 days', date_trunc('hour', now()) - interval '1 hour', interval '1 hour') g(hour)
cross join lateral (select extract(hour from g.hour at time zone 'Asia/Jakarta')::int as lh, extract(isodow from g.hour at time zone 'Asia/Jakarta')::int as dow) t;

-- Songs: ~3.5 min each, ~128 kbps for what came from the server.
insert into usage_hourly (account_id, hour, kind, bytes, requests, disk_bytes, listen_sec, started, completed, skipped)
select name, hour, 'song', b, s * 2, round(b * (0.3 + 0.4 * r2))::bigint, sec, s, c, s - c
from (
  select name, hour, r2, sec, greatest(1, round(sec / 210.0))::int as s,
    round(greatest(1, round(sec / 210.0)) * (0.6 + 0.3 * r3))::int as c,
    round(sec * 16000 * (1 - offline) * (0.7 + 0.6 * r3))::bigint as b
  from (select *, least(3600, round((600 + r2 * 2600) * least(w, 1.1)))::int as sec from demo_hours where r1 < least(w * 0.42, 0.92)) x
) y
on conflict do nothing;

-- Podcast episodes: long sittings at ~49 kbps, never kept on the phone.
insert into usage_hourly (account_id, hour, kind, bytes, requests, disk_bytes, listen_sec, started, completed, skipped)
select name, hour, 'podcast', round(sec * 6100 * (0.9 + 0.2 * r3))::bigint, 6, 0, sec, 1, (r2 > 0.45)::int, (r2 <= 0.45)::int
from (select *, round(900 + r2 * 2700)::int as sec from demo_hours where podcast > 0 and r3 < w * podcast * 0.28) x
on conflict do nothing;

-- Music videos: a few now and then, bytes only (the sound is counted as the song).
insert into usage_hourly (account_id, hour, kind, bytes)
select name, hour, 'video', round((15 + r2 * 70) * 1000000)::bigint
from demo_hours where video > 0 and r2 < w * video * 0.3
on conflict do nothing;

-- The per-day table the quota card and older months read.
insert into usage_daily (account_id, day, audio_bytes, audio_requests, video_bytes)
select account_id, (hour at time zone 'UTC')::date,
  coalesce(sum(bytes) filter (where kind <> 'video'), 0), coalesce(sum(requests), 0), coalesce(sum(bytes) filter (where kind = 'video'), 0)
from usage_hourly where account_id like 'demo-%' group by 1, 2
on conflict do nothing;

-- 14 days of the VM, one sample per 5 minutes (at :30 seconds, so the clear script can tell them from real ones).
insert into system_samples (at, ram_used_bytes, ram_total_bytes, swap_used_bytes, load1, cpus, disk_used_bytes, disk_total_bytes,
  rss_bytes, cache_files, cache_bytes, db_bytes, resolves, resolve_failures, resolve_avg_ms, queue_pending)
select at,
  round((560 + 160 * busy + 40 * random()) * 1048576)::bigint, 1006632960, round((120 + 60 * random()) * 1048576)::bigint,
  (0.15 + 0.9 * busy * random())::real, 2,
  round((7.4 + 0.6 * progress) * 1073741824)::bigint, 32212254720,
  round((150 + 40 * random()) * 1048576)::bigint,
  round(210 + 125 * progress)::int, round((620 + 370 * progress) * 1048576)::bigint, round((38 + 4 * progress) * 1048576)::bigint,
  round(18 * busy * random())::int, (random() < 0.02)::int, round(1500 + 1800 * random() * busy + 300)::int, round(2 * busy * random())::int
from (
  select at, extract(epoch from at - (now() - interval '14 days')) / (14 * 86400) as progress,
    case when extract(hour from at at time zone 'Asia/Jakarta') between 18 and 23 then 1.0
         when extract(hour from at at time zone 'Asia/Jakarta') between 7 and 17 then 0.5 else 0.1 end as busy
  from generate_series(date_trunc('hour', now()) - interval '14 days' + interval '30 seconds', now() - interval '5 minutes', interval '5 minutes') g(at)
) x
on conflict do nothing;

commit;
\echo 'Data contoh terisi: 8 pengguna demo-..., 90 hari pemakaian, 14 hari riwayat Sistem.'
