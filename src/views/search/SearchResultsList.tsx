import { useEffect } from 'react';
import type { Song } from '../../api/types';
import { prefetchAudioResolveOnly } from '../../api/musicClient';
import { SongRow } from '../../components/SongRow/SongRow';
import { SongRowActions } from '../../components/SongMenu/SongRowActions';
import { playSongRadio } from '../../playback/playSongRadio';
import { useSettingsStore } from '../../stores/settingsStore';
import styles from './SearchView.module.css';

// Three, not more: every warm-up is a yt-dlp run on the 1-vCPU backend.
const WARM_TOP_RESULTS = 3;

function SearchResultRow({ song }: { song: Song }) {
  return <SongRow song={song} onClick={() => playSongRadio(song)} trailing={<SongRowActions song={song} />} />;
}

export function SearchResultsList({ songs, isCommitted }: { songs: Song[]; isCommitted: boolean }) {
  const dataSaver = useSettingsStore((state) => state.dataSaver);

  // The first few results are the likeliest taps, and resolving them while the user reads the list (instead of after
  // the tap) is what turns a cold 3-4s start into a cache hit. Up to WARM_TOP_RESULTS, not just #1: the backend
  // serves them from its low lane one at a time and a real tap always jumps ahead of them, and the cleanup below
  // withdraws whatever is still queued when the list changes, so stale results never sit in front of the click.
  //
  // `isCommitted` gates this for a real reason: `songs` updates on every debounced keystroke as a live-typing
  // preview (see SearchView's runDebouncedSearch), each with different top results. Without the gate, natural pauses
  // while typing queued several unrelated resolves ahead of the real click (searches that should take ~2-3s took
  // 15-20s). Only a committed search (Enter / suggestion / recent-search / category tap) warms anything.
  const warmKey = songs.slice(0, WARM_TOP_RESULTS).map((song) => song.id).join(',');
  useEffect(() => {
    if (!warmKey || !isCommitted) return;
    const controller = new AbortController();
    for (const id of warmKey.split(',')) prefetchAudioResolveOnly(id, dataSaver ? 'low' : 'high', controller.signal);
    return () => controller.abort();
  }, [warmKey, isCommitted, dataSaver]);

  return (
    <div className={styles.list}>
      {songs.map((song) => (
        <SearchResultRow key={song.id} song={song} />
      ))}
    </div>
  );
}
