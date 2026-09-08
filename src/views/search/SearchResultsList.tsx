import { useEffect, useState } from 'react';
import type { Song } from '../../api/types';
import { prefetchAudioResolveOnly } from '../../api/musicClient';
import { AddToPlaylistSheet } from '../../components/AddToPlaylistSheet/AddToPlaylistSheet';
import { LikeButton } from '../../components/LikeButton/LikeButton';
import { OptionsMenu } from '../../components/OptionsMenu/OptionsMenu';
import { SongRow } from '../../components/SongRow/SongRow';
import { addToQueue } from '../../jam/jamQueueActions';
import { playSongRadio } from '../../playback/playSongRadio';
import { useSettingsStore } from '../../stores/settingsStore';
import { useToast } from '../../components/Toast/ToastProvider';
import styles from './SearchView.module.css';

function SearchResultRow({ song }: { song: Song }) {
  const { showToast } = useToast();
  const [addToPlaylistOpen, setAddToPlaylistOpen] = useState(false);

  return (
    <SongRow
      song={song}
      onClick={() => playSongRadio(song)}
      trailing={
        <>
          <LikeButton song={song} />
          <OptionsMenu
            items={[
              {
                key: 'queue',
                icon: 'queue',
                label: 'Tambah ke Antrean',
                onClick: () => {
                  addToQueue(song);
                  showToast('Ditambahkan ke antrean.');
                },
              },
              {
                key: 'playlist',
                icon: 'plus',
                label: 'Tambah ke Playlist',
                onClick: () => setAddToPlaylistOpen(true),
              },
            ]}
          />
          <AddToPlaylistSheet song={song} isOpen={addToPlaylistOpen} onClose={() => setAddToPlaylistOpen(false)} />
        </>
      }
    />
  );
}

export function SearchResultsList({ songs, isCommitted }: { songs: Song[]; isCommitted: boolean }) {
  const dataSaver = useSettingsStore((state) => state.dataSaver);
  const topResultId = songs[0]?.id;

  // The #1 result is disproportionately likely to be what gets tapped next —
  // resolving it the moment results land (rather than waiting for the tap)
  // gives yt-dlp's multi-second resolution a head start against however long
  // the user actually spends looking at the list before clicking, instead of
  // that whole delay only starting on tap. Deliberately just the top one: the
  // backend only resolves one track at a time (see pLimit(1) in
  // server/src/youtube/stream.ts) on this 1-vCPU VM, so speculatively
  // resolving more candidates risks queuing *behind* whichever one the user
  // actually taps instead of helping it.
  //
  // `isCommitted` gates this for a real reason, not just tidiness: `songs`
  // updates on every debounced keystroke as a live-typing preview (see
  // SearchView's runDebouncedSearch), each with a potentially different #1
  // result. Without this gate, someone typing a longer title with a couple of
  // natural pauses fires a fresh prefetch per pause — several distinct videos
  // queuing up one after another behind that single-concurrency limiter,
  // ahead of whatever they actually click. That's a real regression this hit
  // in practice (searches that should resolve in ~2-3s took 15-20s once
  // multiple stale prefetches were queued ahead of the real click). Gating on
  // a *committed* search (Enter / suggestion / recent-search / category tap)
  // means this can only ever queue one extra item, for a result set the user
  // actually asked to see.
  useEffect(() => {
    if (!topResultId || !isCommitted) return;
    prefetchAudioResolveOnly(topResultId, dataSaver ? 'low' : 'high');
  }, [topResultId, isCommitted, dataSaver]);

  return (
    <div className={styles.list}>
      {songs.map((song) => (
        <SearchResultRow key={song.id} song={song} />
      ))}
    </div>
  );
}
