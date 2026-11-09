import { useEffect, useState, type FormEvent } from 'react';
import { useToast } from '../../components/Toast/ToastProvider';
import { adminApi, type PodcastPick } from './adminApi';
import styles from './AdminView.module.css';

/**
 * "Pilihan" on everyone's Podcast tab: channels the admin recommends to the circle. Search YouTube channels, add,
 * remove. Admin console text stays Indonesian only (CLAUDE.md #12).
 */
export function PodcastPicksPanel() {
  const { showToast } = useToast();
  const [picks, setPicks] = useState<PodcastPick[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PodcastPick[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = () => void adminApi.podcastPicks().then(setPicks).catch(() => {});
  useEffect(reload, []);

  const search = async (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    try {
      setResults(await adminApi.podcastSearch(query.trim()));
    } catch {
      showToast('Pencarian channel gagal.', { type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const add = async (pick: PodcastPick) => {
    try {
      await adminApi.addPodcastPick(pick);
      showToast(`${pick.name} masuk Pilihan.`);
      reload();
    } catch {
      showToast('Gagal menambahkan.', { type: 'error' });
    }
  };

  const remove = async (pick: PodcastPick) => {
    try {
      await adminApi.removePodcastPick(pick.channelId);
      reload();
    } catch {
      showToast('Gagal menghapus.', { type: 'error' });
    }
  };

  const isPicked = (id: string) => picks.some((p) => p.channelId === id);

  return (
    <>
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Podcast pilihan</h2>
        <p className={styles.muted}>Channel di sini tampil sebagai "Pilihan" di tab Podcast semua pengguna.</p>
        {picks.length === 0 ? (
          <p className={styles.muted}>Belum ada pilihan.</p>
        ) : (
          picks.map((p) => (
            <div key={p.channelId} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' }}>
              <img src={p.avatar} alt="" width={40} height={40} style={{ borderRadius: '50%' }} />
              <span style={{ flex: 1 }}>
                {p.name} <span className={styles.muted}>{p.subscribers}</span>
              </span>
              <button type="button" className={styles.btn} onClick={() => void remove(p)}>
                Hapus
              </button>
            </div>
          ))
        )}
      </section>
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Tambah channel</h2>
        <form className={styles.form} onSubmit={(e) => void search(e)}>
          <input className={styles.input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nama channel YouTube" />
          <button type="submit" className={[styles.btn, styles.btnPrimary].join(' ')} disabled={busy}>
            {busy ? 'Mencari...' : 'Cari'}
          </button>
        </form>
        {results.map((r) => (
          <div key={r.channelId} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0' }}>
            <img src={r.avatar} alt="" width={40} height={40} style={{ borderRadius: '50%' }} />
            <span style={{ flex: 1 }}>
              {r.name} <span className={styles.muted}>{r.subscribers}</span>
            </span>
            <button type="button" className={styles.btn} disabled={isPicked(r.channelId)} onClick={() => void add(r)}>
              {isPicked(r.channelId) ? 'Sudah' : 'Tambah'}
            </button>
          </div>
        ))}
      </section>
    </>
  );
}
