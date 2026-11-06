import { CollectionHero } from '../../components/CollectionHero/CollectionHero';
import { SongRow, SongTable } from '../../components/SongRow/SongRow';
import { SongRowActions } from '../../components/SongMenu/SongRowActions';
import { useT } from '../../i18n/i18n';
import { playSongList } from '../../playback/playSongList';
import { useLibraryStore } from '../../stores/libraryStore';
import styles from './LibraryView.module.css';

export function LikedSongsList() {
  const t = useT();
  const likedSongs = useLibraryStore((state) => state.likedSongs);

  return (
    <>
      <CollectionHero
        kind={t('Playlist')}
        title={t('Lagu Disukai')}
        songs={likedSongs}
        images={likedSongs[0]?.image ?? []}
        fallbackIcon="heart-filled"
        iconCover
      />
      {likedSongs.length === 0 ? (
        <p className={styles.empty}>{t('Lagu yang kamu sukai akan muncul di sini.')}</p>
      ) : (
        <SongTable>
          {likedSongs.map((song, index) => (
            <SongRow key={song.id} song={song} table={{ addedAt: song.addedAt }} onClick={() => playSongList(likedSongs, index)} trailing={<SongRowActions song={song} />} />
          ))}
        </SongTable>
      )}
    </>
  );
}
