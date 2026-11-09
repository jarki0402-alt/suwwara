import { useRef, useState, type ChangeEvent } from 'react';
import { useT } from '../../i18n/i18n';
import { buildImportPayload, readExportifyFiles, type ExportifyPlaylist } from '../../import/exportifyFile';
import { cancelSpotifyImport, dismissSpotifyImport, ImportHttpError, startSpotifyImport, useSpotifyImportStore } from '../../import/spotifyImport';
import { Modal } from '../Modal/Modal';
import modal from '../Modal/Modal.module.css';
import styles from './SpotifyImportSheet.module.css';

interface SpotifyImportSheetProps {
  isOpen: boolean;
  onClose: () => void;
}

// A domain, not a sentence: the same in every language.
const EXPORTIFY_HOST = 'exportify.net';
const EXPORTIFY_URL = `https://${EXPORTIFY_HOST}`;

/**
 * Library -> Impor dari Spotify. Picking files, a preview to choose which playlists, then the progress of the import
 * that runs on the server (src/import/spotifyImport.ts), then what was added and what wasn't found. Closing the sheet
 * mid-import is fine: the import carries on and the playlist card shows its progress.
 */
export function SpotifyImportSheet({ isOpen, onClose }: SpotifyImportSheetProps) {
  const t = useT();
  const importId = useSpotifyImportStore((state) => state.importId);
  const status = useSpotifyImportStore((state) => state.status);
  const report = useSpotifyImportStore((state) => state.report);
  const finished = useSpotifyImportStore((state) => state.finished);
  const fileInput = useRef<HTMLInputElement>(null);
  const [playlists, setPlaylists] = useState<ExportifyPlaylist[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showMissing, setShowMissing] = useState(false);

  const reset = () => {
    setPlaylists(null);
    setSelected(new Set());
    setError(null);
    setShowMissing(false);
  };

  const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const read = (await readExportifyFiles(files)).filter((p) => p.tracks.length > 0);
      if (read.length === 0) {
        setError(t('Tidak ada lagu yang bisa dibaca. Pastikan filenya ZIP atau CSV dari Exportify.'));
        return;
      }
      setPlaylists(read);
      // Saved albums is every song of every saved album: rarely what someone means by their library.
      setSelected(new Set(read.filter((p) => p.kind !== 'savedAlbums').map((p) => p.fileName)));
    } catch {
      setError(t('File ini tidak bisa dibuka. Pastikan filenya ZIP atau CSV dari Exportify.'));
    } finally {
      setBusy(false);
    }
  };

  const chosen = playlists?.filter((p) => selected.has(p.fileName)) ?? [];
  const payload = chosen.length > 0 ? buildImportPayload(chosen) : null;

  const handleStart = async () => {
    if (!payload) return;
    setBusy(true);
    setError(null);
    try {
      await startSpotifyImport(payload);
      reset();
    } catch (err) {
      setError(
        err instanceof ImportHttpError && err.message === 'too_many_tracks'
          ? t('Terlalu banyak lagu sekaligus. Pilih lebih sedikit playlist, lalu impor sisanya setelah ini selesai.')
          : t('Impor belum bisa dimulai. Coba lagi sebentar lagi.'),
      );
    } finally {
      setBusy(false);
    }
  };

  const toggle = (fileName: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(fileName)) next.delete(fileName);
      else next.add(fileName);
      return next;
    });
  };

  const handleClose = () => {
    if (!importId) reset();
    onClose();
  };

  const label = t('Impor dari Spotify');
  let body;

  if (importId && finished) {
    body = (
      <>
        <span className={modal.title}>{status?.status === 'cancelled' ? t('Impor dibatalkan') : t('Impor selesai')}</span>
        <p className={modal.text}>
          {t('{n} lagu ditambahkan ke koleksimu.', { n: report.added })}
          {report.missing.length > 0 ? ` ${t('{n} lagu tidak ditemukan di YouTube Music.', { n: report.missing.length })}` : ''}
        </p>
        {report.missing.length > 0 && (
          <>
            <button type="button" className={styles.linkButton} onClick={() => setShowMissing((v) => !v)}>
              {showMissing ? t('Sembunyikan daftar') : t('Lihat yang tidak ditemukan')}
            </button>
            {showMissing && (
              <ul className={styles.list}>
                {report.missing.map((m, i) => (
                  <li key={`${m.playlist}-${m.name}-${i}`} className={styles.missingRow}>
                    <span className={styles.rowTitle}>{m.name}</span>
                    <span className={styles.rowMeta}>
                      {m.artists.join(', ')} · {m.playlist}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <div className={modal.actions}>
          <button
            type="button"
            className={[modal.button, modal.buttonPrimary].join(' ')}
            onClick={() => {
              dismissSpotifyImport();
              reset();
              onClose();
            }}
          >
            {t('Selesai')}
          </button>
        </div>
      </>
    );
  } else if (importId) {
    const percent = status && status.total > 0 ? Math.round((status.done / status.total) * 100) : 0;
    body = (
      <>
        <span className={modal.title}>{t('Mengimpor dari Spotify')}</span>
        <p className={modal.text}>
          {t('Lagu dicocokkan satu per satu dengan YouTube Music. Tiap playlist langsung masuk koleksi begitu selesai. Kamu boleh menutup ini, impor tetap jalan.')}
        </p>
        <div className={styles.progressTrack} role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <div className={styles.progressFill} style={{ width: `${percent}%` }} />
        </div>
        <span className={styles.rowMeta}>{status ? t('{done} dari {total} lagu', { done: status.done, total: status.total }) : t('Memulai...')}</span>
        <ul className={styles.list}>
          {status?.playlists.map((p) => (
            <li key={p.index} className={styles.row}>
              <span className={styles.rowTitle}>{p.liked ? t('Lagu Disukai') : p.name}</span>
              <span className={styles.rowMeta}>{p.claimed ? t('Sudah masuk') : `${p.done}/${p.total}`}</span>
            </li>
          ))}
        </ul>
        <div className={modal.actions}>
          <button type="button" className={[modal.button, modal.buttonQuiet].join(' ')} onClick={() => void cancelSpotifyImport()}>
            {t('Batalkan impor')}
          </button>
          <button type="button" className={[modal.button, modal.buttonPrimary].join(' ')} onClick={handleClose}>
            {t('Tutup')}
          </button>
        </div>
      </>
    );
  } else if (playlists) {
    body = (
      <>
        <span className={modal.title}>{t('Pilih yang mau diimpor')}</span>
        <ul className={styles.list}>
          {playlists.map((p) => (
            <li key={p.fileName}>
              <label className={styles.checkRow}>
                <input type="checkbox" checked={selected.has(p.fileName)} onChange={() => toggle(p.fileName)} />
                <span className={styles.rowTitle}>
                  {p.kind === 'liked' ? t('Lagu Disukai') : p.kind === 'savedAlbums' ? t('Album Tersimpan') : p.name}
                </span>
                <span className={styles.rowMeta}>{t('{n} lagu', { n: p.tracks.length })}</span>
              </label>
            </li>
          ))}
        </ul>
        {payload && <p className={modal.text}>{t('{n} lagu berbeda akan dicocokkan. Lagu yang sama di beberapa playlist cukup dicari sekali.', { n: payload.tracks.length })}</p>}
        {error && <p className={styles.error}>{error}</p>}
        <div className={modal.actions}>
          <button type="button" className={[modal.button, modal.buttonQuiet].join(' ')} onClick={reset}>
            {t('Kembali')}
          </button>
          <button type="button" className={[modal.button, modal.buttonPrimary].join(' ')} disabled={!payload || busy} onClick={() => void handleStart()}>
            {t('Mulai impor')}
          </button>
        </div>
      </>
    );
  } else {
    body = (
      <>
        <span className={modal.title}>{label}</span>
        <ol className={styles.steps}>
          <li>
            {t('Buka')}{' '}
            <a href={EXPORTIFY_URL} target="_blank" rel="noreferrer">
              {EXPORTIFY_HOST}
            </a>
            {t(', masuk dengan akun Spotify, lalu tekan Export All.')}
          </li>
          <li>{t('Pilih file ZIP yang terunduh (atau beberapa file CSV) di sini.')}</li>
        </ol>
        <p className={modal.text}>{t('Exportify hanya membaca playlist-mu, dan filenya dibaca di perangkat ini. Lagu disukai dan playlist akan dicocokkan dengan YouTube Music lalu masuk ke koleksimu.')}</p>
        {error && <p className={styles.error}>{error}</p>}
        <input ref={fileInput} type="file" accept=".zip,.csv,application/zip,text/csv" multiple hidden onChange={(e) => void handleFiles(e)} />
        <div className={modal.actions}>
          <button type="button" className={[modal.button, modal.buttonQuiet].join(' ')} onClick={handleClose}>
            {t('Batal')}
          </button>
          <button type="button" className={[modal.button, modal.buttonPrimary].join(' ')} disabled={busy} onClick={() => fileInput.current?.click()}>
            {busy ? t('Membaca...') : t('Pilih file')}
          </button>
        </div>
      </>
    );
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} label={label} variant="sheet">
      <div className={styles.body}>{body}</div>
    </Modal>
  );
}
