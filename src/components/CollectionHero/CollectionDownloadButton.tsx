import type { Song } from '../../api/types';
import { useCollectionDownload } from '../../downloads/useCollectionDownload';
import { downloadManager } from '../../downloads/downloadManager';
import { Icon } from '../Icon/Icon';
import styles from './CollectionHero.module.css';

const LABEL: Record<string, string> = {
  checking: 'Memeriksa status unduhan',
  none: 'Unduh playlist ini',
  partial: 'Unduh sisa lagu di playlist ini',
  downloading: 'Batalkan unduhan playlist',
  complete: 'Semua lagu sudah diunduh',
};

/**
 * "Unduh Playlist" — the round button beside shuffle. One tap downloads every song here that isn't offline yet
 * (downloadManager.download() already queues them one at a time, so this never bursts several fetches onto the
 * backend at once); a second tap while it's running cancels whatever hasn't started — see useCollectionDownload
 * for the toast that reports how far it got either way. Shares useSongDownload's sibling hook, so it can never
 * disagree with what an individual song's own "⋯" menu shows.
 */
export function CollectionDownloadButton({ songs }: { songs: Song[] }) {
  const { status, toggle } = useCollectionDownload(songs);
  if (!downloadManager.isSupported || songs.length === 0) return null;

  return (
    <button type="button" className={styles.roundButton} onClick={toggle} aria-label={LABEL[status]} disabled={status === 'checking' || status === 'complete'}>
      <Icon
        name={status === 'downloading' ? 'spinner' : status === 'complete' ? 'check' : 'download'}
        size={22}
        className={status === 'downloading' ? styles.spinning : status === 'complete' ? styles.downloadComplete : undefined}
      />
    </button>
  );
}
