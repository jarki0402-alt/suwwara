import { useEffect, useState } from 'react';
import { Icon, type IconName } from '../../components/Icon/Icon';
import { timeAgo } from '../../utils/deviceLabel';
import { formatBytes } from '../../utils/formatBytes';
import { adminApi } from './adminApi';
import styles from './AdminView.module.css';
import { fillDailySeries, TrendChart, type TrendPoint } from './TrendChart';
import { useAdminData } from './useAdminData';

const REFRESH_MS = 30_000;
const ms = (value: number) => `${value.toLocaleString('id-ID')} ms`;
const percent = (value: number) => `${value.toFixed(0)}%`;
const duration = (seconds: number) => {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return days > 0 ? `${days} hari ${hours} jam` : hours > 0 ? `${hours} jam ${Math.floor((seconds % 3600) / 60)} mnt` : `${Math.floor(seconds / 60)} mnt`;
};

function Stat({ icon, label, value, sub }: { icon: IconName; label: string; value: string; sub?: string }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statIcon}>
        <Icon name={icon} size={16} />
      </span>
      <span className={styles.statBody}>
        <span className={styles.statLabel}>{label}</span>
        <span className={styles.statValue}>{value}</span>
        {sub && <span className={styles.statSub}>{sub}</span>}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionLabel}>{title}</h3>
      <div className={styles.grid}>{children}</div>
    </section>
  );
}

/** Total / average / peak day under a bandwidth chart — the numbers a bar's height alone made you eyeball. */
function ChartFigures({ points }: { points: TrendPoint[] }) {
  const total = points.reduce((sum, point) => sum + point.value, 0);
  const peak = points.reduce((best, point) => (point.value > best.value ? point : best), points[0]);
  return (
    <div className={styles.chartFigures}>
      <span>
        Total <strong>{formatBytes(total)}</strong>
      </span>
      <span>
        Rata-rata/hari <strong>{formatBytes(total / Math.max(points.length, 1))}</strong>
      </span>
      <span>
        Puncak <strong>{formatBytes(peak.value)}</strong> <span className={styles.muted}>({peak.detail})</span>
      </span>
    </div>
  );
}

export function Overview() {
  const { data, error } = useAdminData(adminApi.overview, REFRESH_MS);
  const usage = useAdminData(() => adminApi.usage(14), REFRESH_MS * 4);
  if (error) return <p className={styles.error}>{error}</p>;
  if (!data) return <p className={styles.muted}>Memuat…</p>;
  const points = fillDailySeries(usage.data?.series ?? [], 14);

  return (
    <>
      <Section title="Pengguna">
        <Stat icon="users" label="Pengguna" value={String(data.users)} sub={`${data.activeUsers} aktif 15 mnt terakhir${data.disabled ? ` · ${data.disabled} nonaktif` : ''}`} />
        <Stat icon="devices" label="Perangkat online" value={String(data.onlineDevices)} sub={`${data.sessions} sesi masuk`} />
        <Stat icon="pulse" label="Ruang Jam aktif" value={String(data.jamRooms)} />
        <Stat icon="wifi-off" label="Login terkunci" value={String(data.locked)} sub="sementara diblokir" />
      </Section>

      <Section title="Pemutaran">
        <Stat
          icon="refresh"
          label="Resolve rata-rata"
          value={data.resolve.avgMs === null ? 'Belum ada data' : ms(data.resolve.avgMs)}
          sub={data.resolve.avgMs === null ? '1 jam terakhir sepi' : `p95 ${ms(data.resolve.p95Ms as number)} · terlama ${ms(data.resolve.maxMs as number)}`}
        />
        <Stat icon="queue" label="Resolve 1 jam terakhir" value={String(data.resolve.count)} sub={`${data.resolve.failures} gagal`} />
        <Stat icon="clock" label="Antrean yt-dlp" value={String(data.resolve.queue.pending)} sub={`${data.resolve.queue.active} sedang berjalan`} />
      </Section>

      <section className={styles.section}>
        <h3 className={styles.sectionLabel}>Bandwidth</h3>
        <div className={styles.grid}>
          <Stat icon="pulse" label="Hari ini" value={formatBytes(data.todayBytes)} sub="audio yang dikirim server" />
          <Stat icon="pulse" label="30 hari terakhir" value={formatBytes(data.monthBytes)} />
        </div>
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Kuota bulan ini (patokan)</h2>
          <div className={styles.row}>
            <span>Terpakai bulan berjalan</span>
            <span className={styles.rowValue}>
              {formatBytes(data.bandwidthQuota.usedBytes)} dari {formatBytes(data.bandwidthQuota.quotaBytes)} (
              {percent((data.bandwidthQuota.usedBytes / Math.max(data.bandwidthQuota.quotaBytes, 1)) * 100)})
            </span>
          </div>
          <Meter fraction={data.bandwidthQuota.usedBytes / Math.max(data.bandwidthQuota.quotaBytes, 1)} />
          <p className={styles.muted}>
            Cuma jumlah audio yang lewat server ini, dihitung ulang tiap awal bulan — bukan angka resmi dari akun cloud-mu. Sesuaikan lewat env{' '}
            <code>BANDWIDTH_QUOTA_GB</code> kalau kuota sebenarnya beda.
          </p>
        </div>
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Tren 14 hari terakhir</h2>
          <TrendChart data={points} formatValue={formatBytes} ariaLabel="Pemakaian bandwidth 14 hari terakhir" />
          <ChartFigures points={points} />
        </div>
      </section>
    </>
  );
}

export function UsagePanel() {
  const [days, setDays] = useState(30);
  const { data, error } = useAdminData(() => adminApi.usage(days), REFRESH_MS * 4, String(days));
  const points = fillDailySeries(data?.series ?? [], days);
  const perUser = data?.perUser ?? [];
  const max = Math.max(...perUser.map((row) => row.bytes), 1);

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
        <h2 className={styles.cardTitle}>Bandwidth per hari</h2>
        <TrendChart data={points} formatValue={formatBytes} ariaLabel={`Pemakaian bandwidth ${days} hari terakhir`} />
        <ChartFigures points={points} />
      </div>
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Per pengguna</h2>
        {perUser.length === 0 && <p className={styles.muted}>Belum ada pemakaian.</p>}
        {perUser.map((row, index) => (
          <div key={row.username} className={styles.userBar}>
            <span className={styles.userBarRank}>{index + 1}</span>
            <span className={styles.userBarName}>{row.username}</span>
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

// Rolling in-memory history for the live monitoring sparklines below — module-level so it survives switching tabs
// within the same console session, and resets on reload (no backend metrics history exists to draw from otherwise).
const MAX_SAMPLES = 60; // ~30 min at the 30s poll interval
const ramHistory: TrendPoint[] = [];
const loadHistory: TrendPoint[] = [];

function pushSample(list: TrendPoint[], value: number): void {
  const x = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  const last = list[list.length - 1];
  if (last && last.x === x) {
    last.value = value; // at most one sample per minute shown
    return;
  }
  list.push({ x, value, detail: x });
  while (list.length > MAX_SAMPLES) list.shift();
}

function statusClass(fraction: number): string {
  return fraction > 0.9 ? styles.meterDanger : fraction > 0.75 ? styles.meterWarn : '';
}

function Meter({ fraction }: { fraction: number }) {
  const clamped = Math.min(Math.max(fraction, 0), 1);
  return (
    <div className={styles.meter}>
      <div className={`${styles.meterFill} ${statusClass(clamped)}`} style={{ width: `${clamped * 100}%` }} />
    </div>
  );
}

/** A live metric: current value, a status pill (Normal/Tinggi/Kritis), and a rolling sparkline. */
function Monitor({ title, valueLabel, fraction, history }: { title: string; valueLabel: string; fraction: number; history: TrendPoint[] }) {
  const level = fraction > 0.9 ? 'Kritis' : fraction > 0.75 ? 'Tinggi' : 'Normal';
  const levelClass = fraction > 0.9 ? styles.badgeOff : fraction > 0.75 ? styles.badgeWarn : styles.badge;
  return (
    <div className={styles.monitorCard}>
      <div className={styles.monitorHead}>
        <span className={styles.monitorTitle}>{title}</span>
        <span className={levelClass}>{level}</span>
      </div>
      <span className={styles.monitorValue}>{valueLabel}</span>
      <TrendChart data={history} formatValue={percent} ariaLabel={`${title} — riwayat`} mini />
    </div>
  );
}

export function SystemPanel() {
  const { data, error } = useAdminData(adminApi.system, REFRESH_MS);
  // ramHistory/loadHistory are plain arrays (module-level, not React state — they must survive switching tabs), so
  // mutating them does not by itself trigger a re-render: without this, the sparkline stayed on "Belum ada data"
  // until the *next* 30s poll happened to change `data` for an unrelated reason.
  const [, forceRerender] = useState(0);

  useEffect(() => {
    if (!data) return;
    const ramFraction = (data.host.totalBytes - data.host.availableBytes) / Math.max(data.host.totalBytes, 1);
    const loadFraction = data.host.load[0] / Math.max(data.host.cpus, 1);
    pushSample(ramHistory, ramFraction * 100);
    pushSample(loadHistory, Math.min(loadFraction * 100, 200));
    forceRerender((tick) => tick + 1);
  }, [data]);

  if (error) return <p className={styles.error}>{error}</p>;
  if (!data) return <p className={styles.muted}>Memuat…</p>;
  const usedMem = data.host.totalBytes - data.host.availableBytes;
  const usedDisk = data.disk ? data.disk.totalBytes - data.disk.freeBytes : 0;
  const ramFraction = usedMem / Math.max(data.host.totalBytes, 1);
  const loadFraction = data.host.load[0] / Math.max(data.host.cpus, 1);

  return (
    <>
      <section className={styles.section}>
        <h3 className={styles.sectionLabel}>Pemantauan langsung · diperbarui tiap 30 dtk</h3>
        <div className={styles.monitorGrid}>
          <Monitor title="RAM" valueLabel={`${percent(ramFraction * 100)} · ${formatBytes(usedMem)} / ${formatBytes(data.host.totalBytes)}`} fraction={ramFraction} history={ramHistory} />
          <Monitor title="Beban CPU (1 mnt)" valueLabel={`${percent(loadFraction * 100)} · ${data.host.load[0].toFixed(2)} dari ${data.host.cpus} inti`} fraction={loadFraction} history={loadHistory} />
        </div>
      </section>

      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Server</h2>
        <div className={styles.row}>
          <span>RAM terpakai</span>
          <span className={styles.rowValue}>
            {formatBytes(usedMem)} dari {formatBytes(data.host.totalBytes)} ({percent(ramFraction * 100)})
          </span>
        </div>
        <Meter fraction={ramFraction} />
        <div className={styles.row}>
          <span>Swap terpakai</span>
          <span className={styles.rowValue}>
            {formatBytes(data.host.swapUsedBytes)}
            {data.host.swapTotalBytes > 0 && ` dari ${formatBytes(data.host.swapTotalBytes)} (${percent((data.host.swapUsedBytes / data.host.swapTotalBytes) * 100)})`}
          </span>
        </div>
        {data.host.swapTotalBytes > 0 && <Meter fraction={data.host.swapUsedBytes / data.host.swapTotalBytes} />}
        <div className={styles.row}>
          <span>Beban CPU (1 / 5 / 15 mnt) · {data.host.cpus} inti</span>
          <span className={styles.rowValue}>
            {data.host.load.map((value) => `${value.toFixed(2)} (${percent((value / Math.max(data.host.cpus, 1)) * 100)})`).join(' · ')}
          </span>
        </div>
        {data.disk && (
          <>
            <div className={styles.row}>
              <span>Disk</span>
              <span className={styles.rowValue}>
                {formatBytes(usedDisk)} dari {formatBytes(data.disk.totalBytes)} ({percent((usedDisk / Math.max(data.disk.totalBytes, 1)) * 100)})
              </span>
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
          <span className={styles.rowValue}>
            {formatBytes(data.process.rssBytes)} (heap {formatBytes(data.process.heapUsedBytes)})
          </span>
        </div>
        <div className={styles.row}>
          <span>Berjalan sejak</span>
          <span className={styles.rowValue}>
            {duration(data.process.uptimeSec)} · Node {data.process.node}
          </span>
        </div>
      </div>
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Database · {formatBytes(data.database.sizeBytes)}</h2>
        {data.database.tables.map((table) => (
          <div key={table.name} className={styles.row}>
            <span>{table.name}</span>
            <span className={styles.rowValue}>
              {formatBytes(table.bytes)} · ±{table.rows.toLocaleString('id-ID')} baris
            </span>
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
