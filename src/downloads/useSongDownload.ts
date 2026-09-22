import { useEffect, useState } from 'react';
import type { Song } from '../api/types';
import { downloadManager, type DownloadResult } from './downloadManager';

export type SongDownloadStatus = 'checking' | 'none' | 'downloading' | 'downloaded';

/**
 * Whether `song` is saved for offline, and a way to toggle it — shared by every place that offers "Unduh untuk
 * Offline" (the song "⋯" menu, the standalone button on Now Playing) so they can never drift out of sync with
 * each other or with what's actually sitting in IndexedDB, and a download started from one place is reflected
 * the moment the other place is opened.
 */
export function useSongDownload(song: Song) {
  const [status, setStatus] = useState<SongDownloadStatus>('checking');

  useEffect(() => {
    if (!downloadManager.isSupported) return;
    let cancelled = false;
    const check = () => {
      void downloadManager.has(song.id).then((value) => {
        if (!cancelled) setStatus(value ? 'downloaded' : 'none');
      });
    };
    setStatus('checking');
    check();
    // The same song can be on screen in more than one place at once (Now Playing + a search result row, say) —
    // downloading or removing it from any one of them should update every other instance right away.
    const unsubscribe = downloadManager.subscribe(check);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [song.id]);

  const toggle = async (): Promise<DownloadResult> => {
    if (status === 'downloaded') {
      await downloadManager.remove(song.id);
      setStatus('none');
      return { ok: true };
    }
    setStatus('downloading');
    const result = await downloadManager.download(song);
    setStatus(result.ok ? 'downloaded' : 'none');
    return result;
  };

  return { status, toggle };
}
