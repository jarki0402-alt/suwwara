import { useEffect, useState } from 'react';
import { Icon, type IconName } from '../../components/Icon/Icon';
import { timeAgo } from '../../utils/deviceLabel';
import { formatBytes } from '../../utils/formatBytes';
import { adminApi, type Overview as OverviewData } from './adminApi';
import styles from './AdminView.module.css';
import { TrendChart, type TrendPoint } from './TrendChart';
import { KindSplit } from './UsageCharts';
import { dailyPoints, formatListen, formatRupiah } from './usageFormat';
import { SystemHistory } from './UsageViews';
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

const billMonth = (iso: string) => new Date(new Date(iso).getTime() + 12 * 3_600_000).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

/**
 * This month's Google Cloud bill, estimated from the bytes the server sent (server/src/metrics/billing.ts, calibrated on
 * the real billing export). Replaces the old "200 GB quota" card: that free allowance is for Standard internet egress,
 * while this app's traffic leaves through Cloudflare (Carrier Peering) and is paid from the first GiB.
 */
function BillingCard({ billing }: { billing: OverviewData['billing'] }) {
  const { pricing } = billing;
  const allFree = billing.freeTier.every((check) => check.ok);
  return (
    <div className={styles.card}>
      <h2 className={styles.cardTitle}>Perkiraan tagihan Google Cloud · {billMonth(billing.month.start)}</h2>
      <div className={styles.grid}>
        <Stat icon="pulse" label="Sejauh ini" value={formatRupiah(billing.cost)} sub={`${formatBytes(billing.bytes)} dikirim server`} />
        <Stat
          icon="clock"
          label="Perkiraan akhir bulan"
          value={formatRupiah(billing.projectedCost)}
          sub={`laju 7 hari terakhir ±${formatRupiah(billing.perDayCost)}/hari`}
        />
        <Stat icon="queue" label="Bulan lalu" value={formatRupiah(billing.previousCost)} sub={`${formatBytes(billing.previousBytes)} dikirim server`} />
      </div>
      <p className={styles.muted}>Biaya bulan ini per jenis</p>
      <KindSplit values={billing.byKind} format={formatRupiah} />
      <div className={styles.row}>
        <span>Data keluar ke Cloudflare</span>
        <span className={styles.rowValue}>{formatRupiah(billing.cost)}</span>
      </div>
      <div className={styles.row}>
        <span>VM e2-micro, disk 30 GB, IP publik, data masuk dari YouTube</span>
        <span className={styles.rowValue}>Rp 0 · free tier</span>
      </div>
      {billing.freeTier.map((check) => (
        <div key={check.label} className={styles.row}>
          <span>{check.label}</span>
          <span className={check.ok ? styles.badge : styles.badgeOff}>
            {check.ok ? `aman · ${formatBytes(check.detail)}` : `di luar free tier · ${formatBytes(check.detail)}`}
          </span>
        </div>
      ))}
      {!allFree && <p className={styles.error}>Ada syarat free tier yang tidak terpenuhi: VM atau disknya bisa ikut ditagih. Cek di Google Cloud Console.</p>}
      <p className={styles.muted}>
        Rp {pricing.rpPerGib.toLocaleString('id-ID')}/GiB × {pricing.overhead.toLocaleString('id-ID')} (tagihan ±{Math.round((pricing.overhead - 1) * 100)}% di
        atas hitungan server: API, file aplikasi, tunnel), dikalibrasi dari tagihan Oktober 2026. Data ke Cloudflare tidak termasuk jatah gratis 200 GiB. Bulan
        dipotong menurut waktu Pacific seperti tagihan Google. Atur lewat env <code>EGRESS_RP_PER_GIB</code> dan <code>EGRESS_OVERHEAD</code>.
      </p>
    </div>
  );
}

export function Overview({ onOpenUsage }: { onOpenUsage: () => void }) {
  const { data, error } = useAdminData(adminApi.overview, REFRESH_MS);
  const usage = useAdminData(() => adminApi.usage(14), REFRESH_MS * 4);
  if (error) return <p className={styles.error}>{error}</p>;
  if (!data) return <p className={styles.muted}>Memuat…</p>;
  // Same days as the server grouped them (this browser's timezone), each the total of every kind.
  const points: TrendPoint[] = dailyPoints(usage.data?.series ?? [], 14, 'bytes').map((point) => ({
    x: point.x,
    detail: point.detail,
    value: point.values.song + point.values.podcast + point.values.video,
  }));

  return (
    <>
      <Section title="Pengguna">
        <Stat icon="users" label="Pengguna" value={String(data.users)} sub={`${data.activeUsers} aktif 15 mnt terakhir${data.disabled ? ` · ${data.disabled} nonaktif` : ''}`} />
        <Stat icon="devices" label="Perangkat online" value={String(data.onlineDevices)} sub={`${data.sessions} sesi masuk`} />
        <Stat icon="pulse" label="Ruang Jam aktif" value={String(data.jamRooms)} />
        <Stat icon="wifi-off" label="Login terkunci" value={String(data.locked)} sub="sementara diblokir" />
      </Section>

      <section className={styles.section}>
        <h3 className={styles.sectionLabel}>Hari ini · dibanding kemarin (WIB)</h3>
        <div className={styles.grid}>
          <Stat
            icon="clock"
            label="Waktu dengar"
            value={formatListen(data.today.songSec + data.today.podcastSec)}
            sub={`kemarin ${formatListen(data.yesterday.songSec + data.yesterday.podcastSec)} · podcast ${formatListen(data.today.podcastSec)}`}
          />
          <Stat
            icon="queue"
            label="Lagu & episode diputar"
            value={data.today.plays.toLocaleString('id-ID')}
            sub={`kemarin ${data.yesterday.plays.toLocaleString('id-ID')}`}
          />
          <Stat
            icon="pulse"
            label="Data hari ini"
            value={formatBytes(data.today.songBytes + data.today.podcastBytes + data.today.videoBytes)}
            sub={`kemarin ${formatBytes(data.yesterday.songBytes + data.yesterday.podcastBytes + data.yesterday.videoBytes)}`}
          />
          <Stat
            icon="speaker"
            label="Sedang mendengarkan"
            value={String(data.listeningNow.length)}
            sub={data.listeningNow.length ? data.listeningNow.map((row) => row.username).join(', ') : 'tidak ada'}
          />
        </div>
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Data hari ini per jenis</h2>
          <KindSplit values={{ song: data.today.songBytes, podcast: data.today.podcastBytes, video: data.today.videoBytes }} format={formatBytes} />
          <div className={styles.actions}>
            <button type="button" className={styles.btn} onClick={onOpenUsage}>
              Rincian pemakaian per pengguna
            </button>
          </div>
        </div>
      </section>

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
        <h3 className={styles.sectionLabel}>Bandwidth & tagihan</h3>
        <div className={styles.grid}>
          <Stat icon="pulse" label="Hari ini" value={formatBytes(data.todayBytes)} sub="audio yang dikirim server" />
          <Stat icon="pulse" label="30 hari terakhir" value={formatBytes(data.monthBytes)} />
        </div>
        <BillingCard billing={data.billing} />
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Tren 14 hari terakhir</h2>
          <TrendChart data={points} formatValue={formatBytes} ariaLabel="Pemakaian bandwidth 14 hari terakhir" />
          <ChartFigures points={points} />
        </div>
      </section>
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
      <TrendChart data={history} formatValue={percent} ariaLabel={`Riwayat ${title}`} mini />
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
      {data.audioCache && (
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Cache lagu di disk server</h2>
          <div className={styles.row}>
            <span>{data.audioCache.files.toLocaleString('id-ID')} file lagu</span>
            <span className={styles.rowValue}>
              {formatBytes(data.audioCache.bytes)} dari batas {formatBytes(data.audioCache.maxBytes)} (
              {percent((data.audioCache.bytes / Math.max(data.audioCache.maxBytes, 1)) * 100)})
            </span>
          </div>
          <Meter fraction={data.audioCache.bytes / Math.max(data.audioCache.maxBytes, 1)} />
          <p className={styles.muted}>
            Lagu di sini diputar langsung dari disk VM, tanpa yt-dlp dan tanpa unduh ulang dari YouTube. Penuh: yang paling lama tak diputar dihapus duluan.
          </p>
        </div>
      )}
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
      <SystemHistory />
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

const REPORT_LABELS: Record<string, string> = {
  system_pause: 'Dijeda oleh sistem',
  system_pause_recovered: 'Dijeda sistem, lanjut lagi',
  system_pause_stopped: 'Dijeda sistem, lagu berhenti',
  background_retry: 'Gagal di background, terus dicoba',
  background_recovered: 'Pulih di background',
  background_failed: 'Masih gagal saat app dibuka',
  killed_in_background: 'App dimatikan sistem saat memutar',
  stopped_silently: 'Berhenti diam-diam di background',
  frozen_in_background: 'Halaman dibekukan di background',
  session_hold: 'Ditahan sesi akun',
  takeover_pause: 'Dijeda perangkat lain',
  became_remote: 'Jadi remote perangkat lain',
};

/** Playback trouble the devices reported themselves (screen off, another app in front). Kept in the server's memory only. */
export function PlaybackPanel() {
  const { data, error, reload } = useAdminData(adminApi.playbackReports, REFRESH_MS);
  const reports = data ?? [];
  return (
    <>
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Laporan pemutaran</h2>
        <p className={styles.muted}>
          Dikirim otomatis oleh perangkat saat musik terganggu ketika layar mati atau app lain di depan. Disimpan di memori server (200 terbaru), hilang saat
          server dimulai ulang.
        </p>
        {reports.length === 0 && <p className={styles.muted}>Belum ada laporan.</p>}
        {reports.length > 0 && (
          <div className={styles.events}>
            {reports.map((report) => (
              <div key={`${report.at}-${report.username}-${report.event}`} className={styles.event}>
                <span className={report.event === 'background_recovered' || report.event === 'system_pause_recovered' ? undefined : styles.eventBad}>
                  {REPORT_LABELS[report.event] ?? report.event} · {report.username}
                </span>
                <span className={styles.rowValue}>{timeAgo(new Date(report.at).toISOString())}</span>
                <details className={styles.eventMeta}>
                  <summary>{report.detail.split('\n')[0]}</summary>
                  <pre className={styles.reportDetail}>{`${report.device}\n${report.detail}`}</pre>
                </details>
              </div>
            ))}
          </div>
        )}
        {reports.length > 0 && (
          <button type="button" className={styles.btn} onClick={() => void adminApi.clearPlaybackReports().then(reload)}>
            Bersihkan
          </button>
        )}
      </div>
    </>
  );
}
