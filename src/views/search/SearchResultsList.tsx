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

export function SearchResultsList({ songs }: { songs: Song[] }) {
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
  useEffect(() => {
    if (!topResultId) return;
    prefetchAudioResolveOnly(topResultId, dataSaver ? 'low' : 'high');
  }, [topResultId, dataSaver]);

  return (
    <div className={styles.list}>
      {songs.map((song) => (
        <SearchResultRow key={song.id} song={song} />
      ))}
    </div>
  );
}
