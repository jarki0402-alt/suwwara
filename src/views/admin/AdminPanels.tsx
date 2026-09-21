import { useState } from 'react';
import { timeAgo } from '../../utils/deviceLabel';
import { formatBytes } from '../../utils/formatBytes';
import { adminApi } from './adminApi';
import styles from './AdminView.module.css';
import { BarChart } from './BarChart';
import { useAdminData } from './useAdminData';

const REFRESH_MS = 30_000;
const ms = (value: number | null) => (value === null ? '—' : `${value.toLocaleString('id-ID')} ms`);
const duration = (seconds: number) => {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return days > 0 ? `${days} hari ${hours} jam` : hours > 0 ? `${hours} jam ${Math.floor((seconds % 3600) / 60)} mnt` : `${Math.floor(seconds / 60)} mnt`;
};

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
      {sub && <span className={styles.statSub}>{sub}</span>}
    </div>
  );
}

function Meter({ fraction }: { fraction: number }) {
  const clamped = Math.min(Math.max(fraction, 0), 1);
  return (
    <div className={styles.meter}>
      <div className={`${styles.meterFill} ${clamped > 0.9 ? styles.meterDanger : clamped > 0.75 ? styles.meterWarn : ''}`} style={{ width: `${clamped * 100}%` }} />
    </div>
  );
}

export function Overview() {
  const { data, error } = useAdminData(adminApi.overview, REFRESH_MS);
  const usage = useAdminData(() => adminApi.usage(14), REFRESH_MS * 4);
  if (error) return <p className={styles.error}>{error}</p>;
  if (!data) return <p className={styles.muted}>Memuat…</p>;
  return (
    <>
      <div className={styles.grid}>
        <Stat label="Pengguna" value={String(data.users)} sub={`${data.activeUsers} aktif 15 mnt terakhir${data.disabled ? ` · ${data.disabled} nonaktif` : ''}`} />
        <Stat label="Bandwidth hari ini" value={formatBytes(data.todayBytes)} sub="audio yang dikirim server" />
        <Stat label="Bandwidth 30 hari" value={formatBytes(data.monthBytes)} />
        <Stat label="Perangkat online" value={String(data.onlineDevices)} sub={`${data.sessions} sesi masuk · ${data.jamRooms} ruang Jam`} />
        <Stat label="Resolve rata-rata" value={ms(data.resolve.avgMs)} sub={`p95 ${ms(data.resolve.p95Ms)} · terlama ${ms(data.resolve.maxMs)}`} />
        <Stat label="Resolve 1 jam" value={String(data.resolve.count)} sub={`${data.resolve.failures} gagal`} />
        <Stat label="Antrean yt-dlp" value={`${data.resolve.queue.pending}`} sub={`${data.resolve.queue.active} berjalan`} />
        <Stat label="Terkunci" value={String(data.locked)} sub="login diblokir sementara" />
      </div>
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Bandwidth 14 hari terakhir</h2>
        <BarChart data={usage.data?.series ?? []} />
      </div>
    </>
  );
}

export function UsagePanel() {
  const [days, setDays] = useState(30);
  const { data, error } = useAdminData(() => adminApi.usage(days), REFRESH_MS * 4, String(days));
  const max = Math.max(...(data?.perUser ?? []).map((row) => row.bytes), 1);
  const total = (data?.series ?? []).reduce((sum, point) => sum + point.bytes, 0);
  return (
    <>
      <div className={styles.chips}>
        {[7, 30, 90].map((option) => (
          <button key={option} type="button" className={`${styles.tab} ${days === option ? styles.tabActive : ''}`} onClick={() => setDays(option)}>
            {option} hari
          </button>
        ))}
      </div>
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Per hari · total {formatBytes(total)}</h2>
        <BarChart data={data?.series ?? []} />
      </div>
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Per pengguna</h2>
        {(data?.perUser ?? []).length === 0 && <p className={styles.muted}>Belum ada pemakaian.</p>}
        {(data?.perUser ?? []).map((row) => (
          <div key={row.username} className={styles.userBar}>
            <span>{row.username}</span>
            <div className={styles.meter}>
              <div className={styles.meterFill} style={{ width: `${(row.bytes / max) * 100}%` }} />
            </div>
            <span className={styles.rowValue}>{formatBytes(row.bytes)}</span>
          </div>
        ))}
        <p className={styles.muted}>Hanya jumlah byte yang dikirim server — bukan lagu apa yang diputar. Total sisi Cloudflare ada di dashboard Cloudflare.</p>
      </div>
    </>
  );
}

export function SystemPanel() {
  const { data, error } = useAdminData(adminApi.system, REFRESH_MS);
  if (error) return <p className={styles.error}>{error}</p>;
  if (!data) return <p className={styles.muted}>Memuat…</p>;
  const usedMem = data.host.totalBytes - data.host.availableBytes;
  const usedDisk = data.disk ? data.disk.totalBytes - data.disk.freeBytes : 0;
  return (
    <>
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Server</h2>
        <div className={styles.row}>
          <span>RAM terpakai</span>
          <span className={styles.rowValue}>{formatBytes(usedMem)} dari {formatBytes(data.host.totalBytes)}</span>
        </div>
        <Meter fraction={usedMem / Math.max(data.host.totalBytes, 1)} />
        <div className={styles.row}>
          <span>Swap terpakai</span>
          <span className={styles.rowValue}>{formatBytes(data.host.swapUsedBytes)}</span>
        </div>
        <div className={styles.row}>
          <span>Beban CPU (1 / 5 / 15 mnt)</span>
          <span className={styles.rowValue}>{data.host.load.map((value) => value.toFixed(2)).join(' / ')} · {data.host.cpus} inti</span>
        </div>
        {data.disk && (
          <>
            <div className={styles.row}>
              <span>Disk</span>
              <span className={styles.rowValue}>{formatBytes(usedDisk)} dari {formatBytes(data.disk.totalBytes)}</span>
            </div>
            <Meter fraction={usedDisk / Math.max(data.disk.totalBytes, 1)} />
          </>
        )}
        <div className={styles.row}>
          <span>Server menyala</span>
          <span className={styles.rowValue}>{duration(data.host.uptimeSec)}</span>
        </div>
      </div>
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Aplikasi (backend)</h2>
        <div className={styles.row}>
          <span>Memori proses</span>
          <span className={styles.rowValue}>{formatBytes(data.process.rssBytes)} (heap {formatBytes(data.process.heapUsedBytes)})</span>
        </div>
        <div className={styles.row}>
          <span>Berjalan sejak</span>
          <span className={styles.rowValue}>{duration(data.process.uptimeSec)} · Node {data.process.node}</span>
        </div>
      </div>
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Database · {formatBytes(data.database.sizeBytes)}</h2>
        {data.database.tables.map((table) => (
          <div key={table.name} className={styles.row}>
            <span>{table.name}</span>
            <span className={styles.rowValue}>{formatBytes(table.bytes)} · ±{table.rows.toLocaleString('id-ID')} baris</span>
          </div>
        ))}
      </div>
    </>
  );
}

const EVENT_LABELS: Record<string, string> = {
  login_ok: 'Masuk',
  login_failed: 'Gagal masuk',
  login_locked: 'Percobaan saat terkunci',
  password_changed: 'Sandi diganti',
  password_change_failed: 'Gagal ganti sandi',
  admin_user_created: 'Pengguna dibuat',
  admin_password_reset: 'Sandi direset',
  admin_user_updated: 'Pengguna diubah',
  admin_signed_out: 'Dikeluarkan dari semua perangkat',
  admin_user_deleted: 'Pengguna dihapus',
  admin_unlock: 'Kunci dibuka',
};

export function SecurityPanel() {
  const { data, error, reload } = useAdminData(adminApi.audit, REFRESH_MS);
  return (
    <>
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Sedang terkunci</h2>
        {(data?.locked ?? []).length === 0 && <p className={styles.muted}>Tidak ada. 5 kali salah sandi mengunci pasangan IP + pengguna selama 15 menit.</p>}
        {(data?.locked ?? []).map((lock) => (
          <div key={lock.key} className={styles.row}>
            <span>{lock.key}</span>
            <span className={styles.rowValue}>
              {Math.ceil(lock.retryAfterSec / 60)} mnt{' '}
              <button type="button" className={styles.btn} onClick={() => void adminApi.unlock(lock.key).then(reload)}>
                Buka
              </button>
            </span>
          </div>
        ))}
      </div>
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Aktivitas terbaru</h2>
        <div className={styles.events}>
          {(data?.events ?? []).map((event) => (
            <div key={event.id} className={styles.event}>
              <span className={event.event.includes('failed') || event.event.includes('locked') ? styles.eventBad : undefined}>
                {EVENT_LABELS[event.event] ?? event.event}
                {event.username ? ` · ${event.username}` : ''}
              </span>
              <span className={styles.rowValue}>{timeAgo(event.at)}</span>
              <span className={styles.eventMeta}>{[event.ip, event.detail].filter(Boolean).join(' · ')}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
