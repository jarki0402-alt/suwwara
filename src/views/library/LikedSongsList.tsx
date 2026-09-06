import { LikeButton } from '../../components/LikeButton/LikeButton';
import { SongRow } from '../../components/SongRow/SongRow';
import { playSongList } from '../../playback/playSongList';
import { useLibraryStore } from '../../stores/libraryStore';
import styles from './LibraryView.module.css';

export function LikedSongsList() {
  const likedSongs = useLibraryStore((state) => state.likedSongs);

  if (likedSongs.length === 0) {
    return <p className={styles.empty}>Lagu yang kamu sukai akan muncul di sini.</p>;
  }

  return (
    <div>
      {likedSongs.map((song, index) => (
        <SongRow
          key={song.id}
          song={song}
          onClick={() => playSongList(likedSongs, index)}
          trailing={<LikeButton song={song} />}
        />
      ))}
    </div>
  );
}
