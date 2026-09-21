import { CollectionHero } from '../../components/CollectionHero/CollectionHero';
import { SongRow } from '../../components/SongRow/SongRow';
import { SongRowActions } from '../../components/SongMenu/SongRowActions';
import { playSongList } from '../../playback/playSongList';
import { useLibraryStore } from '../../stores/libraryStore';
import styles from './LibraryView.module.css';

export function LikedSongsList() {
  const likedSongs = useLibraryStore((state) => state.likedSongs);

  return (
    <>
      <CollectionHero
        kind="Playlist"
        title="Lagu Disukai"
        songs={likedSongs}
        images={likedSongs[0]?.image ?? []}
        fallbackIcon="heart-filled"
        iconCover
      />
      {likedSongs.length === 0 ? (
        <p className={styles.empty}>Lagu yang kamu sukai akan muncul di sini.</p>
      ) : (
        <div>
          {likedSongs.map((song, index) => (
            <SongRow key={song.id} song={song} onClick={() => playSongList(likedSongs, index)} trailing={<SongRowActions song={song} />} />
          ))}
        </div>
      )}
    </>
  );
}
