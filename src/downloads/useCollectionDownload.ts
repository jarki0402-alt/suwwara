import { useCallback, useEffect, useRef, useState } from 'react';
import type { Song } from '../api/types';
import { useToast } from '../components/Toast/ToastProvider';
import { downloadManager } from './downloadManager';

export type CollectionDownloadStatus = 'checking' | 'none' | 'partial' | 'downloading' | 'complete';

export interface CollectionDownloadProgress {
  done: number;
  total: number;
}

/**
 * Bulk sibling of useSongDownload.ts — "Unduh Playlist" next to a collection's shuffle button. Deliberately just
 * an orchestrator around downloadManager.download() called once per song: that function already serializes
 * everything through its own one-at-a-time queue (see downloadManager.ts's own note on why), so kicking off the
 * whole list here doesn't risk hammering the backend — it naturally lines up behind whatever's already queued.
 */
export function useCollectionDownload(songs: Song[]) {
  const [downloadedCount, setDownloadedCount] = useState<number | null>(null);
  const [progress, setProgress] = useState<CollectionDownloadProgress | null>(null);
  // A ref, not state: read inside the download loop below without retriggering the effect that owns it.
  const cancelRequested = useRef(false);
  const { showToast } = useToast();

  const recount = useCallback(() => {
    if (!downloadManager.isSupported || songs.length === 0) {
      setDownloadedCount(0);
      return;
    }
    void Promise.all(songs.map((song) => downloadManager.has(song.id))).then((flags) => {
      setDownloadedCount(flags.filter(Boolean).length);
    });
  }, [songs]);

  useEffect(() => {
    recount();
    // A song downloaded/removed elsewhere (its own "⋯" menu, Now Playing, the Diunduh tab) can change this
    // collection's own tally without this hook ever re-running on its own — recount whenever anything changes.
    return downloadManager.subscribe(recount);
  }, [recount]);

  const start = async () => {
    const haveFlags = await Promise.all(songs.map((song) => downloadManager.has(song.id)));
    const pending = songs.filter((_, index) => !haveFlags[index]);
    if (pending.length === 0) return;

    cancelRequested.current = false;
    setProgress({ done: 0, total: pending.length });
    let done = 0;
    let quotaHit = false;
    for (const song of pending) {
      if (cancelRequested.current) break;
      const result = await downloadManager.download(song);
      done += 1;
      setProgress({ done, total: pending.length });
      if (!result.ok && result.reason === 'quota') {
        quotaHit = true;
        break;
      }
    }
    const cancelled = cancelRequested.current && !quotaHit;
    setProgress(null);
    recount();

    if (quotaHit) {
      showToast(`${done} dari ${pending.length} lagu berhasil diunduh. Kuota penyimpanan penuh, sisanya dilewati.`);
    } else if (cancelled) {
      showToast(`Unduhan playlist dibatalkan setelah ${done} dari ${pending.length} lagu.`);
    }
  };

  const toggle = () => {
    if (progress) {
      cancelRequested.current = true;
      return;
    }
    void start();
  };

  const status: CollectionDownloadStatus = progress
    ? 'downloading'
    : downloadedCount === null
      ? 'checking'
      : downloadedCount === 0 || songs.length === 0
        ? 'none'
        : downloadedCount === songs.length
          ? 'complete'
          : 'partial';

  return { status, progress, toggle };
}
