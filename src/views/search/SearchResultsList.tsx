import { useState } from 'react';
import type { Song } from '../../api/types';
import { AddToPlaylistSheet } from '../../components/AddToPlaylistSheet/AddToPlaylistSheet';
import { LikeButton } from '../../components/LikeButton/LikeButton';
import { OptionsMenu } from '../../components/OptionsMenu/OptionsMenu';
import { SongRow } from '../../components/SongRow/SongRow';
import { addToQueue } from '../../jam/jamQueueActions';
import { playSongRadio } from '../../playback/playSongRadio';
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
  return (
    <div className={styles.list}>
      {songs.map((song) => (
        <SearchResultRow key={song.id} song={song} />
      ))}
    </div>
  );
}
