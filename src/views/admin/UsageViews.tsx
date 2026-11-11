import { useMemo, useState } from 'react';
import { Icon } from '../../components/Icon/Icon';
import { deviceLabel, timeAgo } from '../../utils/deviceLabel';
import { formatBytes } from '../../utils/formatBytes';
import { adminApi, type ByKind, type KindTotals, type Pricing, type SystemSample, type UsageKind, type UserUsage } from './adminApi';
import styles from './AdminView.module.css';
import { TrendChart, type TrendPoint } from './TrendChart';
import { HourHeatmap, KindSplit, Legend, StackedBars } from './UsageCharts';
import { costOf, dailyPoints, formatListen, formatMetric, formatRupiah, hourLabel, type Metric, type StackPoint } from './usageFormat';
import { useAdminData } from './useAdminData';

/**
 * The usage pages of the admin console: Pemakaian (everyone), one person's page, Laporan (a month against the one
 * before), the Podcast numbers and the Sistem history. Numbers only: how long, how much, when, never which song.
 */

const REFRESH_MS = 120_000;
const listenOf = (k: ByKind) => k.song.listenSec + k.podcast.listenSec;
const bytesOf = (k: ByKind) => k.song.bytes + k.podcast.bytes + k.video.bytes;
const percent = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '-');
const date = (iso: string) => new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
const dateTime = (iso: string) => new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const kindsLabel = (kinds: string[]) => [...new Set(kinds.map((kind) => (kind === 'mobile' ? 'HP' : kind === 'tablet' ? 'tablet' : 'desktop')))].join(', ');

function Stat({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statBody}>
        <span className={styles.statLabel}>{label}</span>
        <span className={styles.statValue}>{value}</span>
        {sub && <span className={styles.statSub}>{sub}</span>}
      </span>
    </div>
  );
}

function RangeChips({
  value,
  options,
  onChange,
  labelOf = (option) => `${option} hari`,
}: {
  value: number;
  options: number[];
  onChange: (value: number) => void;
  labelOf?: (option: number) => string;
}) {
  return (
    <div className={`${styles.chips} ${styles.noPrint}`}>
      {options.map((option) => (
        <button key={option} type="button" className={`${styles.tab} ${value === option ? styles.tabActive : ''}`} onClick={() => onChange(option)}>
          {labelOf(option)}
        </button>
      ))}
    </div>
  );
}

function MetricToggle({ value, onChange }: { value: Metric; onChange: (value: Metric) => void }) {
  return (
    <div className={`${styles.toggle} ${styles.noPrint}`} role="group" aria-label="Satuan grafik">
      <button type="button" className={value === 'listenSec' ? styles.toggleOn : ''} aria-pressed={value === 'listenSec'} onClick={() => onChange('listenSec')}>
        Waktu dengar
      </button>
      <button type="button" className={value === 'bytes' ? styles.toggleOn : ''} aria-pressed={value === 'bytes'} onClick={() => onChange('bytes')}>
        Data
      </button>
    </div>
  );
}

/** Time is reported by devices, which only started with this version: until then a chart of it is empty, not zero. */
function ListenNote({ since, rangeDays }: { since: string | null; rangeDays: number }) {
  const [openedAt] = useState(() => Date.now());
  const rangeStart = openedAt - (rangeDays - 1) * 86_400_000;
  if (since && new Date(since).getTime() <= rangeStart) return null;
  return (
    <p className={styles.note}>
      {since
        ? `Waktu dengar dan jumlah lagu tercatat mulai ${date(since)}, sejak HP pengguna memakai versi aplikasi ini. Data (MB) sudah tercatat lebih lama.`
        : 'Waktu dengar dan jumlah lagu belum tercatat: angkanya muncul begitu HP pengguna memakai versi aplikasi ini dan memutar sesuatu. Data (MB) sudah tercatat.'}
    </p>
  );
}

function kindValues(totals: ByKind, metric: Metric): Record<UsageKind, number> {
  return { song: totals.song[metric], podcast: totals.podcast[metric], video: totals.video[metric] };
}

/** "+12%" / "−8%" against an earlier figure, or nothing when there is nothing to compare with. */
function Delta({ now, before }: { now: number; before: number }) {
  if (before <= 0) return null;
  const change = Math.round(((now - before) / before) * 100);
  return <span className={styles.delta}>{change === 0 ? 'sama' : `${change > 0 ? '+' : '−'}${Math.abs(change)}%`}</span>;
}

// ---- CSV -----------------------------------------------------------------------------------------

function downloadCsv(name: string, rows: Array<Array<string | number>>): void {
  const text = rows.map((row) => row.map((cell) => (typeof cell === 'number' ? String(cell) : `"${cell.replace(/"/g, '""')}"`)).join(',')).join('\n');
  // BOM so Excel opens the Indonesian text as UTF-8.
  const url = URL.createObjectURL(new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const MB = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;
const minutes = (seconds: number) => Math.round(seconds / 60);

function usersCsv(name: string, users: UserUsage[], pricing: Pricing): void {
  downloadCsv(name, [
    [
      'Pengguna',
      'Menit dengar lagu',
      'Menit dengar podcast',
      'Lagu diputar',
      'Lagu selesai',
      'Lagu di-skip',
      'Episode diputar',
      'Episode selesai',
      'MB lagu',
      'MB podcast',
      'MB video',
      'MB dari cache disk',
      'Perkiraan biaya GCP (Rp)',
      'Hari aktif',
      'Jam tersibuk',
      'Terakhir aktif',
    ],
    ...users.map((user) => [
      user.username,
      minutes(user.song.listenSec),
      minutes(user.podcast.listenSec),
      user.song.started,
      user.song.completed,
      user.song.skipped,
      user.podcast.started,
      user.podcast.completed,
      MB(user.song.bytes),
      MB(user.podcast.bytes),
      MB(user.video.bytes),
      MB(user.song.diskBytes + user.podcast.diskBytes),
      Math.round(costOf(bytesOf(user), pricing)),
      user.activeDays,
      user.peakHour === null ? '' : hourLabel(user.peakHour),
      user.lastSeen ?? '',
    ]),
  ]);
}

function dailyCsv(name: string, series: Array<{ day: string } & ByKind>, pricing: Pricing): void {
  downloadCsv(name, [
    [
      'Tanggal',
      'Menit dengar lagu',
      'Menit dengar podcast',
      'Lagu diputar',
      'Episode diputar',
      'MB lagu',
      'MB podcast',
      'MB video',
      'Perkiraan biaya GCP (Rp)',
    ],
    ...series.map((row) => [
      row.day,
      minutes(row.song.listenSec),
      minutes(row.podcast.listenSec),
      row.song.started,
      row.podcast.started,
      MB(row.song.bytes),
      MB(row.podcast.bytes),
      MB(row.video.bytes),
      Math.round(costOf(bytesOf(row), pricing)),
    ]),
  ]);
}

// ---- the per-person table ------------------------------------------------------------------------

type SortKey = 'name' | 'listen' | 'songs' | 'podcast' | 'bytes' | 'video' | 'days' | 'seen';
const SORTS: Record<SortKey, (user: UserUsage) => number | string> = {
  name: (user) => user.username,
  listen: (user) => listenOf(user),
  songs: (user) => user.song.started,
  podcast: (user) => user.podcast.listenSec,
  bytes: (user) => bytesOf(user),
  video: (user) => user.video.bytes,
  days: (user) => user.activeDays,
  seen: (user) => user.lastSeen ?? '',
};

const SORT_LABELS: Array<[SortKey, string]> = [
  ['listen', 'Waktu dengar'],
  ['songs', 'Lagu diputar'],
  ['podcast', 'Podcast'],
  ['bytes', 'Data'],
  ['video', 'Video'],
  ['days', 'Hari aktif'],
  ['seen', 'Terakhir aktif'],
  ['name', 'Nama'],
];

function UserTable({ users, pricing, onOpenUser }: { users: UserUsage[]; pricing: Pricing; onOpenUser: (accountId: string) => void }) {
  const [sort, setSort] = useState<SortKey>('listen');
  const sorted = useMemo(() => {
    const key = SORTS[sort];
    return [...users].sort((a, b) => {
      const x = key(a);
      const y = key(b);
      return typeof x === 'string' ? (sort === 'name' ? x.localeCompare(String(y)) : String(y).localeCompare(x)) : (y as number) - x;
    });
  }, [users, sort]);
  const head = (key: SortKey, label: string) => (
    <th>
      <button type="button" aria-pressed={sort === key} onClick={() => setSort(key)}>
        {label}
        {sort === key ? ' ↓' : ''}
      </button>
    </th>
  );
  if (users.length === 0) return <p className={styles.muted}>Belum ada pengguna.</p>;
  return (
    <>
      {/* Phones: nine columns don't fit, and a table you scroll sideways ran past the card. One card per person instead,
        everything visible, the order picked from a menu. Wider screens keep the table (CSS decides which shows). */}
      <div className={styles.userCards}>
        <div className={styles.selectWrap}>
          <select className={styles.select} value={sort} onChange={(event) => setSort(event.target.value as SortKey)} aria-label="Urutkan">
            {SORT_LABELS.map(([key, label]) => (
              <option key={key} value={key}>
                Urutkan: {label}
              </option>
            ))}
          </select>
          <Icon name="chevron-down" size={16} className={styles.selectChevron} />
        </div>
        {sorted.map((user) => {
          const listen = listenOf(user);
          const facts = [
            user.song.started > 0
              ? `${user.song.started.toLocaleString('id-ID')} lagu · ${percent(user.song.completed, user.song.completed + user.song.skipped)} selesai`
              : null,
            user.podcast.listenSec > 0 ? `podcast ${formatListen(user.podcast.listenSec)}` : null,
            bytesOf(user) > 0 ? `data ${formatBytes(bytesOf(user))} ≈ ${formatRupiah(costOf(bytesOf(user), pricing))}` : null,
            user.video.bytes > 0 ? `video ${formatBytes(user.video.bytes)}` : null,
          ].filter(Boolean);
          const when = [
            user.activeDays ? `${user.activeDays} hari aktif` : null,
            user.peakHour === null ? null : `sibuk ${hourLabel(user.peakHour)}`,
            user.lastSeen ? `terakhir ${timeAgo(user.lastSeen)}` : null,
          ].filter(Boolean);
          return (
            <button key={user.accountId} type="button" className={styles.userCard} onClick={() => onOpenUser(user.accountId)}>
              <span className={styles.userCardTop}>
                <span className={styles.userCardName}>
                  {user.listeningOn.length > 0 && <span className={styles.liveDot} />}
                  {user.username}
                  {user.disabled && <span className={styles.muted}> · nonaktif</span>}
                </span>
                <strong>{listen > 0 ? formatListen(listen) : '-'}</strong>
              </span>
              {facts.length > 0 && <span className={styles.userCardLine}>{facts.join(' · ')}</span>}
              <span className={styles.userCardLine}>{when.length ? when.join(' · ') : 'belum ada pemakaian'}</span>
            </button>
          );
        })}
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              {head('name', 'Pengguna')}
              {head('listen', 'Waktu dengar')}
              {head('songs', 'Lagu')}
              {head('podcast', 'Podcast')}
              {head('bytes', 'Data')}
              <th>Biaya</th>
              {head('video', 'Video')}
              {head('days', 'Hari aktif')}
              <th>Jam sibuk</th>
              {head('seen', 'Terakhir aktif')}
            </tr>
          </thead>
          <tbody>
            {sorted.map((user) => (
              <tr key={user.accountId} onClick={() => onOpenUser(user.accountId)}>
                <td>
                  {user.listeningOn.length > 0 && <span className={styles.liveDot} title={`Sedang mendengarkan di ${kindsLabel(user.listeningOn)}`} />}
                  <button type="button" className={styles.linkButton} onClick={() => onOpenUser(user.accountId)}>
                    {user.username}
                  </button>
                  {user.disabled && <span className={styles.muted}> · nonaktif</span>}
                </td>
                <td>
                  <strong>{listenOf(user) > 0 ? formatListen(listenOf(user)) : '-'}</strong>
                </td>
                <td title={`${user.song.completed} selesai · ${user.song.skipped} di-skip`}>
                  {user.song.started > 0 ? `${user.song.started} · ${percent(user.song.completed, user.song.completed + user.song.skipped)} selesai` : '-'}
                </td>
                <td>{user.podcast.listenSec > 0 ? formatListen(user.podcast.listenSec) : user.podcast.bytes > 0 ? formatBytes(user.podcast.bytes) : '-'}</td>
                <td>{bytesOf(user) > 0 ? formatBytes(bytesOf(user)) : '-'}</td>
                <td>{bytesOf(user) > 0 ? formatRupiah(costOf(bytesOf(user), pricing)) : '-'}</td>
                <td>{user.video.bytes > 0 ? formatBytes(user.video.bytes) : '-'}</td>
                <td>{user.activeDays || '-'}</td>
                <td>{user.peakHour === null ? '-' : hourLabel(user.peakHour)}</td>
                <td>{user.lastSeen ? timeAgo(user.lastSeen) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---- Pemakaian -----------------------------------------------------------------------------------

export function UsagePanel({ onOpenUser }: { onOpenUser: (accountId: string) => void }) {
  const [days, setDays] = useState(30);
  const [metric, setMetric] = useState<Metric>('listenSec');
  const { data, error } = useAdminData(() => adminApi.usage(days), REFRESH_MS, String(days));
  if (error) return <p className={styles.error}>{error}</p>;
  if (!data) return <p className={styles.muted}>Memuat…</p>;

  const { totals } = data;
  const audioBytes = totals.song.bytes + totals.podcast.bytes;
  const diskBytes = totals.song.diskBytes + totals.podcast.diskBytes;
  const active = data.perUser.filter((user) => user.activeDays > 0).length;
  const format = formatMetric(metric);
  const chartKinds: UsageKind[] = metric === 'bytes' ? ['song', 'podcast', 'video'] : ['song', 'podcast'];
  const isToday = days === 1;
  // "Hari ini": the day so far hour by hour (one bar per day would be a single bar).
  const nowHour = new Date().getHours();
  const hourPoints: StackPoint[] = data.todayByHour.slice(0, nowHour + 1).map((row, hour) => ({
    x: String(hour).padStart(2, '0'),
    detail: `${hourLabel(hour)}–${hourLabel((hour + 1) % 24)}`,
    values: { song: row.song[metric], podcast: row.podcast[metric], video: row.video[metric] },
  }));

  return (
    <>
      {!isToday && <TodayTiles today={data.today} yesterday={data.yesterday} pricing={data.pricing} />}
      <div className={styles.toolbar}>
        <RangeChips value={days} options={[1, 7, 30, 90]} onChange={setDays} labelOf={(option) => (option === 1 ? 'Hari ini' : `${option} hari`)} />
        <button
          type="button"
          className={`${styles.btn} ${styles.noPrint}`}
          onClick={() => usersCsv(isToday ? 'suwwara-pengguna-hari-ini.csv' : `suwwara-pengguna-${days}hari.csv`, data.perUser, data.pricing)}
        >
          Unduh CSV
        </button>
      </div>
      <ListenNote since={data.listenSince} rangeDays={days} />

      <section className={styles.section}>
        <div className={styles.grid}>
          <Stat
            label="Waktu dengar"
            value={formatListen(listenOf(totals))}
            sub={`lagu ${formatListen(totals.song.listenSec)} · podcast ${formatListen(totals.podcast.listenSec)}`}
          />
          <Stat
            label="Data dikirim server"
            value={formatBytes(bytesOf(totals))}
            sub={totals.video.bytes > 0 ? `termasuk video ${formatBytes(totals.video.bytes)}` : undefined}
          />
          <Stat
            label="Lagu diputar"
            value={totals.song.started.toLocaleString('id-ID')}
            sub={`${percent(totals.song.completed, totals.song.completed + totals.song.skipped)} sampai selesai · ${totals.song.skipped.toLocaleString('id-ID')} di-skip`}
          />
          <Stat label="Episode podcast" value={totals.podcast.started.toLocaleString('id-ID')} sub={`${totals.podcast.completed} sampai selesai`} />
          <Stat label="Pengguna aktif" value={`${active} dari ${data.perUser.length}`} sub={isToday ? 'hari ini' : `dalam ${days} hari`} />
          <Stat label="Dari cache disk server" value={percent(diskBytes, audioBytes)} sub={`${formatBytes(diskBytes)} tanpa ke YouTube`} />
          <Stat
            label="Perkiraan biaya Google Cloud"
            value={formatRupiah(costOf(bytesOf(totals), data.pricing))}
            sub={`lagu ${formatRupiah(costOf(totals.song.bytes, data.pricing))} · podcast ${formatRupiah(costOf(totals.podcast.bytes, data.pricing))} · video ${formatRupiah(costOf(totals.video.bytes, data.pricing))}`}
          />
        </div>
      </section>

      <div className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>{isToday ? 'Per jam, hari ini' : 'Per hari'}</h2>
          <MetricToggle value={metric} onChange={setMetric} />
        </div>
        <Legend kinds={chartKinds} totals={kindValues(totals, metric)} format={format} />
        <StackedBars
          points={isToday ? hourPoints : dailyPoints(data.series, days, metric)}
          kinds={chartKinds}
          format={format}
          metric={metric}
          ariaLabel={isToday ? 'Pemakaian per jam hari ini' : `Pemakaian per hari, ${days} hari terakhir`}
        />
      </div>

      {/* A single day's weekday row says nothing a per-hour chart doesn't. */}
      {!isToday && (
        <div className={styles.card}>
          <h2 className={styles.cardTitle}>Kapan didengarkan</h2>
          <HourHeatmap heatmap={data.heatmap} metric={listenOf(totals) > 0 ? 'listen' : 'bytes'} />
        </div>
      )}

      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Pembagian</h2>
        <p className={styles.muted}>Data (MB)</p>
        <KindSplit values={kindValues(totals, 'bytes')} format={formatBytes} />
        {listenOf(totals) > 0 && (
          <>
            <p className={styles.muted}>Waktu dengar</p>
            <KindSplit values={{ ...kindValues(totals, 'listenSec'), video: 0 }} format={formatListen} />
          </>
        )}
      </div>

      <div className={styles.card}>
        <h2 className={styles.cardTitle}>{isToday ? 'Per pengguna, hari ini' : 'Per pengguna'}</h2>
        <UserTable users={data.perUser} pricing={data.pricing} onOpenUser={onOpenUser} />
        <p className={styles.muted}>
          Klik nama untuk rinciannya. Waktu dengar dihitung HP (termasuk lagu yang diputar dari simpanan HP), data hanya yang lewat server. Tidak ada judul lagu
          yang tercatat.
        </p>
      </div>
    </>
  );
}

// ---- one person ----------------------------------------------------------------------------------

/** One person's today next to their yesterday (the admin's days), above the range charts. */
function TodayTiles({ today, yesterday, pricing }: { today: ByKind; yesterday: ByKind; pricing: Pricing }) {
  const plays = (k: ByKind) => k.song.started + k.podcast.started;
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionLabel}>Hari ini · dibanding kemarin</h3>
      <div className={styles.grid}>
        <Stat
          label="Waktu dengar"
          value={formatListen(listenOf(today))}
          sub={
            <>
              kemarin {formatListen(listenOf(yesterday))} <Delta now={listenOf(today)} before={listenOf(yesterday)} />
              {today.podcast.listenSec > 0 ? ` · podcast ${formatListen(today.podcast.listenSec)}` : ''}
            </>
          }
        />
        <Stat
          label="Lagu & episode diputar"
          value={plays(today).toLocaleString('id-ID')}
          sub={`kemarin ${plays(yesterday).toLocaleString('id-ID')} · ${today.song.completed} selesai · ${today.song.skipped} di-skip`}
        />
        <Stat
          label="Data dari server"
          value={formatBytes(bytesOf(today))}
          sub={`kemarin ${formatBytes(bytesOf(yesterday))}${today.video.bytes > 0 ? ` · video ${formatBytes(today.video.bytes)}` : ''}`}
        />
        <Stat
          label="Perkiraan biaya"
          value={formatRupiah(costOf(bytesOf(today), pricing))}
          sub={`kemarin ${formatRupiah(costOf(bytesOf(yesterday), pricing))}`}
        />
      </div>
    </section>
  );
}

export function UserDetailPanel({ accountId, onBack }: { accountId: string; onBack: () => void }) {
  const [days, setDays] = useState(30);
  const [metric, setMetric] = useState<Metric>('listenSec');
  const { data, error } = useAdminData(() => adminApi.userUsage(accountId, days), REFRESH_MS, `${accountId}:${days}`);

  const back = (
    <button type="button" className={`${styles.backButton} ${styles.noPrint}`} onClick={onBack}>
      <Icon name="chevron-left" size={16} /> Kembali
    </button>
  );
  if (error)
    return (
      <>
        {back}
        <p className={styles.error}>{error}</p>
      </>
    );
  if (!data)
    return (
      <>
        {back}
        <p className={styles.muted}>Memuat…</p>
      </>
    );

  const { totals, user } = data;
  const format = formatMetric(metric);
  const chartKinds: UsageKind[] = metric === 'bytes' ? ['song', 'podcast', 'video'] : ['song', 'podcast'];
  const activeDays = data.series.filter((row) => listenOf(row) > 0 || bytesOf(row) > 0).length;
  const listen = listenOf(totals);
  // Last 48 hours, every hour shown (empty ones too) so the shape of the day reads.
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const byHour = new Map(data.last48h.map((row) => [new Date(row.hour).getTime(), row]));
  const hourPoints: StackPoint[] = Array.from({ length: 48 }, (_, i) => {
    const at = new Date(now.getTime() - (47 - i) * 3_600_000);
    const row = byHour.get(at.getTime());
    return {
      x: String(at.getHours()),
      detail: at.toLocaleString('id-ID', { weekday: 'short', hour: '2-digit', minute: '2-digit' }),
      values: { song: row?.song[metric] ?? 0, podcast: row?.podcast[metric] ?? 0, video: row?.video[metric] ?? 0 },
    };
  });

  return (
    <>
      {back}
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>
            {user.listeningOn.length > 0 && <span className={styles.liveDot} />}
            {user.username}
            {user.disabled && <span className={styles.muted}> · nonaktif</span>}
          </h2>
          <span className={styles.muted}>{user.listeningOn.length > 0 ? `Sedang mendengarkan di ${kindsLabel(user.listeningOn)}` : ''}</span>
        </div>
        <div className={styles.row}>
          <span>Akun dibuat</span>
          <span className={styles.rowValue}>{date(user.createdAt)}</span>
        </div>
        <div className={styles.row}>
          <span>Terakhir masuk</span>
          <span className={styles.rowValue}>{user.lastLoginAt ? dateTime(user.lastLoginAt) : '-'}</span>
        </div>
      </div>

      <TodayTiles today={data.today} yesterday={data.yesterday} pricing={data.pricing} />

      <h3 className={styles.sectionLabel}>Rentang</h3>
      <RangeChips value={days} options={[7, 30, 90]} onChange={setDays} />
      <section className={styles.section}>
        <div className={styles.grid}>
          <Stat
            label="Waktu dengar"
            value={formatListen(listen)}
            sub={`lagu ${formatListen(totals.song.listenSec)} · podcast ${formatListen(totals.podcast.listenSec)}`}
          />
          <Stat label="Rata-rata per hari aktif" value={activeDays ? formatListen(listen / activeDays) : '-'} sub={`${activeDays} hari aktif dari ${days}`} />
          <Stat
            label="Lagu diputar"
            value={totals.song.started.toLocaleString('id-ID')}
            sub={`${totals.song.completed} selesai · ${totals.song.skipped} di-skip`}
          />
          <Stat label="Episode podcast" value={totals.podcast.started.toLocaleString('id-ID')} sub={`${totals.podcast.completed} selesai`} />
          <Stat
            label="Data dari server"
            value={formatBytes(bytesOf(totals))}
            sub={`lagu ${formatBytes(totals.song.bytes)} · podcast ${formatBytes(totals.podcast.bytes)} · video ${formatBytes(totals.video.bytes)}`}
          />
          <Stat
            label="Data per jam dengar"
            value={listen > 0 ? formatBytes((bytesOf(totals) / listen) * 3600) : '-'}
            sub="kecil = banyak dari simpanan HP, besar = banyak video"
          />
          <Stat
            label="Perkiraan biaya Google Cloud"
            value={formatRupiah(costOf(bytesOf(totals), data.pricing))}
            sub={listen > 0 ? `±${formatRupiah((costOf(bytesOf(totals), data.pricing) / listen) * 3600)} per jam dengar` : `dalam ${days} hari`}
          />
        </div>
      </section>

      <div className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>48 jam terakhir</h2>
          <MetricToggle value={metric} onChange={setMetric} />
        </div>
        <Legend kinds={chartKinds} />
        <StackedBars points={hourPoints} kinds={chartKinds} format={format} metric={metric} ariaLabel="Pemakaian per jam, 48 jam terakhir" />
      </div>

      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Per hari</h2>
        <Legend kinds={chartKinds} totals={kindValues(totals, metric)} format={format} />
        <StackedBars
          points={dailyPoints(data.series, days, metric)}
          kinds={chartKinds}
          format={format}
          metric={metric}
          ariaLabel={`Pemakaian ${user.username} per hari`}
        />
      </div>

      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Kapan didengarkan</h2>
        <HourHeatmap heatmap={data.heatmap} metric={listen > 0 ? 'listen' : 'bytes'} />
      </div>

      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Perangkat yang sedang masuk · {data.devices.length}</h2>
        {data.devices.length === 0 && <p className={styles.muted}>Tidak ada sesi aktif.</p>}
        {data.devices.map((device, index) => (
          <div key={index} className={styles.row}>
            <span>{deviceLabel(device.userAgent)}</span>
            <span className={styles.rowValue}>
              aktif {timeAgo(device.lastSeen)} · masuk {date(device.signedInAt)}
            </span>
          </div>
        ))}
      </div>

      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Laporan masalah pemutaran · {data.reports.length}</h2>
        {data.reports.length === 0 && <p className={styles.muted}>Tidak ada laporan sejak server terakhir dinyalakan.</p>}
        {data.reports.slice(0, 20).map((report) => (
          <div key={report.at} className={styles.row}>
            <span>{report.event}</span>
            <span className={styles.rowValue}>
              {deviceLabel(report.device)} · {timeAgo(new Date(report.at).toISOString())}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

// ---- Laporan -------------------------------------------------------------------------------------

const monthName = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
};

export function ReportPanel({ onOpenUser }: { onOpenUser: (accountId: string) => void }) {
  const [month, setMonth] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>('listenSec');
  const { data, error } = useAdminData(() => adminApi.report(month), undefined, month ?? '');
  if (error) return <p className={styles.error}>{error}</p>;
  if (!data) return <p className={styles.muted}>Memuat…</p>;

  const { current, previous } = data;
  const [y, m] = data.month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const today = new Date();
  const isCurrent = today.getFullYear() === y && today.getMonth() + 1 === m;
  const elapsed = isCurrent ? today.getDate() : daysInMonth;
  const format = formatMetric(metric);
  const chartKinds: UsageKind[] = metric === 'bytes' ? ['song', 'podcast', 'video'] : ['song', 'podcast'];
  const song = (s: typeof current) => s.totals.song;
  const completion = (t: KindTotals) => (t.completed + t.skipped > 0 ? t.completed / (t.completed + t.skipped) : 0);
  const top = [...data.perUser].sort((a, b) => listenOf(b) - listenOf(a) || bytesOf(b) - bytesOf(a));
  const bytesNow = Math.max(bytesOf(current.totals), current.dailyTableBytes);

  return (
    <>
      <div className={`${styles.toolbar} ${styles.noPrint}`}>
        <div className={styles.selectWrap}>
          <select className={styles.select} value={data.month} onChange={(event) => setMonth(event.target.value)} aria-label="Bulan">
            {data.months.map((option) => (
              <option key={option} value={option}>
                {monthName(option)}
              </option>
            ))}
          </select>
          <Icon name="chevron-down" size={16} className={styles.selectChevron} />
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.btn} onClick={() => usersCsv(`suwwara-laporan-${data.month}-pengguna.csv`, data.perUser, data.pricing)}>
            CSV pengguna
          </button>
          <button type="button" className={styles.btn} onClick={() => dailyCsv(`suwwara-laporan-${data.month}-harian.csv`, data.series, data.pricing)}>
            CSV harian
          </button>
          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} onClick={() => window.print()}>
            Cetak / PDF
          </button>
        </div>
      </div>

      <div className={styles.card}>
        <h2 className={styles.cardTitle}>
          Laporan {monthName(data.month)}
          {isCurrent ? ` · berjalan, ${elapsed} dari ${daysInMonth} hari` : ''}
        </h2>
        <p className={styles.muted}>
          Dibandingkan dengan {monthName(`${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`)}. Zona waktu {data.tz}.
        </p>
      </div>

      <section className={styles.section}>
        <div className={styles.grid}>
          <Stat
            label="Pengguna aktif"
            value={String(current.activeUsers)}
            sub={
              <>
                bulan lalu {previous.activeUsers} <Delta now={current.activeUsers} before={previous.activeUsers} />
              </>
            }
          />
          <Stat
            label="Waktu dengar"
            value={formatListen(listenOf(current.totals))}
            sub={
              <>
                bulan lalu {formatListen(listenOf(previous.totals))} <Delta now={listenOf(current.totals)} before={listenOf(previous.totals)} />
              </>
            }
          />
          <Stat
            label="Data dikirim"
            value={formatBytes(bytesNow)}
            sub={
              <>
                bulan lalu {formatBytes(Math.max(bytesOf(previous.totals), previous.dailyTableBytes))}{' '}
                <Delta now={bytesNow} before={Math.max(bytesOf(previous.totals), previous.dailyTableBytes)} />
              </>
            }
          />
          <Stat
            label="Lagu diputar"
            value={song(current).started.toLocaleString('id-ID')}
            sub={
              <>
                bulan lalu {song(previous).started.toLocaleString('id-ID')} <Delta now={song(current).started} before={song(previous).started} /> ·{' '}
                {Math.round(completion(song(current)) * 100)}% selesai
              </>
            }
          />
          <Stat
            label="Podcast"
            value={formatListen(current.totals.podcast.listenSec)}
            sub={
              <>
                {current.totals.podcast.started} episode <Delta now={current.totals.podcast.listenSec} before={previous.totals.podcast.listenSec} />
              </>
            }
          />
          <Stat label="Video musik" value={formatBytes(current.totals.video.bytes)} sub={<>bulan lalu {formatBytes(previous.totals.video.bytes)}</>} />
          <Stat
            label={isCurrent ? 'Tagihan Google Cloud sejauh ini' : 'Tagihan Google Cloud (perkiraan)'}
            value={formatRupiah(data.gcp.current.cost)}
            sub={
              <>
                bulan lalu {formatRupiah(data.gcp.previous.cost)} <Delta now={data.gcp.current.cost} before={data.gcp.previous.cost} />
              </>
            }
          />
          {isCurrent && (
            <Stat
              label="Perkiraan tagihan akhir bulan"
              value={formatRupiah((data.gcp.current.cost / Math.max(elapsed, 1)) * daysInMonth)}
              sub={`±${formatBytes((bytesNow / Math.max(elapsed, 1)) * daysInMonth)} data, dengan laju sejauh ini`}
            />
          )}
          {data.resolve && data.resolve.count > 0 && (
            <Stat
              label="Lama memuat lagu"
              value={data.resolve.avgMs === null ? '-' : `${(data.resolve.avgMs / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} dtk`}
              sub={`${data.resolve.count.toLocaleString('id-ID')} resolve · ${data.resolve.failures} gagal (14 hari terakhir saja)`}
            />
          )}
        </div>
      </section>

      <div className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>Per hari</h2>
          <MetricToggle value={metric} onChange={setMetric} />
        </div>
        <Legend kinds={chartKinds} totals={kindValues(current.totals, metric)} format={format} />
        <StackedBars
          points={dailyPoints(data.series, daysInMonth, metric, new Date(y, m - 1, 1))}
          kinds={chartKinds}
          format={format}
          metric={metric}
          ariaLabel={`Pemakaian per hari, ${monthName(data.month)}`}
        />
      </div>

      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Kapan didengarkan</h2>
        <HourHeatmap heatmap={data.heatmap} metric={listenOf(current.totals) > 0 ? 'listen' : 'bytes'} />
      </div>

      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Pembagian data</h2>
        <KindSplit values={kindValues(current.totals, 'bytes')} format={formatBytes} />
      </div>

      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Pengguna</h2>
        <UserTable users={top} pricing={data.pricing} onOpenUser={onOpenUser} />
      </div>
      <p className={styles.muted}>
        Rincian per jam disimpan 90 hari, per hari (MB) 400 hari. Waktu dengar dihitung HP, data (MB) dihitung server. Tidak ada judul lagu atau episode yang
        tercatat. Tagihan Google Cloud: Rp {data.pricing.rpPerGib.toLocaleString('id-ID')}/GiB × {data.pricing.overhead.toLocaleString('id-ID')} untuk data ke
        Cloudflare (VM, disk, dan IP gratis lewat free tier), bulan dipotong menurut waktu Pacific seperti tagihan Google, jadi bisa sedikit beda dari angka
        bulan WIB di atas.
      </p>
    </>
  );
}

// ---- Podcast numbers (above the Pilihan admin) ---------------------------------------------------

export function PodcastStats({ onOpenUser }: { onOpenUser: (accountId: string) => void }) {
  const [days, setDays] = useState(30);
  const [metric, setMetric] = useState<Metric>('listenSec');
  const { data, error } = useAdminData(() => adminApi.usage(days), REFRESH_MS, String(days));
  if (error) return <p className={styles.error}>{error}</p>;
  if (!data) return <p className={styles.muted}>Memuat…</p>;
  const podcast = data.totals.podcast;
  const listeners = data.perUser
    .filter((user) => user.podcast.listenSec > 0 || user.podcast.bytes > 0)
    .sort((a, b) => b.podcast.listenSec - a.podcast.listenSec || b.podcast.bytes - a.podcast.bytes);
  const format = formatMetric(metric);

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionLabel}>Statistik podcast</h3>
      <RangeChips value={days} options={[7, 30, 90]} onChange={setDays} />
      <div className={styles.grid}>
        <Stat
          label="Waktu dengar"
          value={formatListen(podcast.listenSec)}
          sub={`${percent(podcast.listenSec, listenOf(data.totals))} dari semua waktu dengar`}
        />
        <Stat label="Episode diputar" value={podcast.started.toLocaleString('id-ID')} sub={`${podcast.completed} sampai selesai`} />
        <Stat
          label="Data"
          value={formatBytes(podcast.bytes)}
          sub={`≈ ${formatRupiah(costOf(podcast.bytes, data.pricing))} · ${percent(podcast.bytes, bytesOf(data.totals))} dari semua data`}
        />
        <Stat label="Pendengar" value={`${listeners.length} dari ${data.perUser.length}`} sub={`dalam ${days} hari`} />
      </div>
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>Podcast per hari</h2>
          <MetricToggle value={metric} onChange={setMetric} />
        </div>
        <StackedBars points={dailyPoints(data.series, days, metric)} kinds={['podcast']} format={format} metric={metric} ariaLabel="Podcast per hari" />
      </div>
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Pendengar podcast</h2>
        {listeners.length === 0 && <p className={styles.muted}>Belum ada yang mendengarkan podcast di rentang ini.</p>}
        {listeners.map((user) => (
          <div key={user.accountId} className={styles.row}>
            <button type="button" className={styles.linkButton} onClick={() => onOpenUser(user.accountId)}>
              {user.username}
            </button>
            <span className={styles.rowValue}>
              {formatListen(user.podcast.listenSec)} · {user.podcast.started} episode · {formatBytes(user.podcast.bytes)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---- Sistem history -------------------------------------------------------------------------------

export function SystemHistory() {
  const [hours, setHours] = useState(24);
  const { data, error } = useAdminData(() => adminApi.systemHistory(hours), REFRESH_MS, String(hours));
  if (error) return <p className={styles.error}>{error}</p>;
  if (!data) return <p className={styles.muted}>Memuat…</p>;
  const label = (iso: string) => {
    const at = new Date(iso);
    return hours <= 24
      ? at.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
      : at.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
  };
  // A stretch with nothing to measure (no song loaded in those minutes) is left out, not drawn as zero seconds.
  const series = (pick: (sample: SystemSample) => number | null): TrendPoint[] =>
    data.samples.flatMap((sample) => {
      const value = pick(sample);
      return value === null ? [] : [{ x: label(sample.at), value, detail: dateTime(sample.at) }];
    });
  const resolves = data.samples.reduce((sum, sample) => sum + sample.resolves, 0);
  const failures = data.samples.reduce((sum, sample) => sum + sample.failures, 0);
  const pct = (value: number) => `${Math.round(value)}%`;
  const charts: Array<{ title: string; points: TrendPoint[]; format: (value: number) => string; note?: string }> = [
    { title: 'RAM terpakai', points: series((s) => s.ram * 100), format: pct },
    { title: 'Beban CPU', points: series((s) => s.load * 100), format: pct },
    {
      title: 'Lama memuat lagu (resolve yt-dlp)',
      points: series((s) => s.avgMs),
      format: (v) => `${(v / 1000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} dtk`,
      note: `${resolves.toLocaleString('id-ID')} resolve · ${failures.toLocaleString('id-ID')} gagal (${percent(failures, resolves)}) dalam rentang ini. Lagu dari cache tidak perlu resolve.`,
    },
    { title: 'Cache lagu di disk', points: series((s) => s.cacheBytes), format: formatBytes },
    { title: 'Disk terpakai', points: series((s) => (s.disk === null ? null : s.disk * 100)), format: pct },
  ];

  return (
    <section className={styles.section}>
      <h3 className={styles.sectionLabel}>Riwayat · dicatat tiap 5 menit, disimpan 14 hari</h3>
      <RangeChips value={hours} options={[24, 168, 336]} onChange={setHours} labelOf={(option) => (option === 24 ? '24 jam' : `${option / 24} hari`)} />
      {data.samples.length === 0 ? (
        <p className={styles.note}>Belum ada riwayat. Server mencatat kondisi VM tiap 5 menit mulai versi ini, grafiknya terisi sendiri.</p>
      ) : (
        charts.map((chart) => (
          <div key={chart.title} className={styles.card}>
            <h2 className={styles.cardTitle}>{chart.title}</h2>
            <TrendChart data={chart.points} formatValue={chart.format} ariaLabel={`Riwayat ${chart.title}`} />
            {chart.note && <p className={styles.muted}>{chart.note}</p>}
          </div>
        ))
      )}
    </section>
  );
}
