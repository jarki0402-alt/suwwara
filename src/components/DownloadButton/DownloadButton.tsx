import type { MouseEvent } from 'react';
import type { Song } from '../../api/types';
import { useToast } from '../Toast/ToastProvider';
import { useSongDownload } from '../../downloads/useSongDownload';
import { Icon } from '../Icon/Icon';
import styles from './DownloadButton.module.css';

const LABEL: Record<string, string> = {
  checking: 'Memeriksa status unduhan',
  none: 'Unduh untuk offline',
  downloading: 'Mengunduh',
  downloaded: 'Hapus unduhan',
};

/**
 * Standalone unduh icon for Now Playing (normal + fullscreen) — sits right beside LikeButton, same visual weight,
 * since offline download is exactly as first-class an action here as liking a song. Same status the song's "⋯"
 * menu shows (useSongDownload.ts is the single source of truth for both), so downloading from one place is
 * reflected instantly wherever else the same song shows up.
 */
export function DownloadButton({ song, size = 20 }: { song: Song; size?: number }) {
  const { status, toggle } = useSongDownload(song);
  const { showToast } = useToast();

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (status === 'checking' || status === 'downloading') return;
    void toggle().then((result) => {
      if (result.ok) return;
      showToast(result.reason === 'quota' ? 'Batas unduhan sudah penuh. Hapus lagu lama di Pengaturan dulu.' : 'Gagal mengunduh lagu ini.');
    });
  };

  return (
    <button type="button" className={styles.button} onClick={handleClick} aria-label={LABEL[status]} disabled={status === 'checking'}>
      <Icon
        name={status === 'downloading' ? 'spinner' : status === 'downloaded' ? 'check' : 'download'}
        size={size}
        className={[status === 'downloading' ? styles.spinning : '', status === 'downloaded' ? styles.downloaded : ''].join(' ')}
      />
    </button>
  );
}
