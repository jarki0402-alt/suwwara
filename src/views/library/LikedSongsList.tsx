import { CollectionHero } from '../../components/CollectionHero/CollectionHero';
import { SongRow, SongTable } from '../../components/SongRow/SongRow';
import { SongRowActions } from '../../components/SongMenu/SongRowActions';
import { useT } from '../../i18n/i18n';
import { playSongList } from '../../playback/playSongList';
import { useLibraryStore } from '../../stores/libraryStore';
import styles from './LibraryView.module.css';

/**
 * Lagu Disukai: inside Koleksi's tab, or (with `onBack`) as its own page over the current menu, like a playlist page
 * (Spotify's Liked Songs): no rename, no delete, no "add songs" box, since a song gets here by liking it.
 */
export function LikedSongsList({ onBack }: { onBack?: () => void } = {}) {
  const t = useT();
  const likedSongs = useLibraryStore((state) => state.likedSongs);
  const list =
    likedSongs.length === 0 ? (
      <p className={styles.empty}>{t('Lagu yang kamu sukai akan muncul di sini.')}</p>
    ) : (
      <SongTable>
        {likedSongs.map((song, index) => (
          <SongRow key={song.id} song={song} table={{ addedAt: song.addedAt }} onClick={() => playSongList(likedSongs, index)} trailing={<SongRowActions song={song} />} />
        ))}
      </SongTable>
    );

  if (onBack) {
    return (
      <div className={styles.detail}>
        <CollectionHero
          kind={t('Playlist')}
          title={t('Lagu Disukai')}
          songs={likedSongs}
          images={likedSongs[0]?.image ?? []}
          fallbackIcon="heart-filled"
          iconCover
          onBack={onBack}
        />
        <div className={styles.detailBody}>{list}</div>
      </div>
    );
  }

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
