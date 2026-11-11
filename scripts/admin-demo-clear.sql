-- Menghapus data contoh dari scripts/admin-demo-seed.sql (KHUSUS LAPTOP). Aman: hanya akun "demo-..." (pemakaiannya ikut
-- terhapus lewat foreign key) dan sampel Sistem buatan script itu (yang detiknya :30; sampel asli selalu di detik :00).
--
--   docker compose exec -T postgres psql -U suwwara -d suwwara < scripts/admin-demo-clear.sql

begin;
delete from accounts where id like 'demo-%';
delete from system_samples where extract(second from at) = 30;
commit;
\echo 'Data contoh dihapus.'
