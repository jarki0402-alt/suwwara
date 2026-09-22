import { useEffect, useState } from 'react';
import { CollectionHero } from '../../components/CollectionHero/CollectionHero';
import { SongRow, SongTable } from '../../components/SongRow/SongRow';
import { SongRowActions } from '../../components/SongMenu/SongRowActions';
import { downloadManager, type DownloadRecord } from '../../downloads/downloadManager';
import { playSongList } from '../../playback/playSongList';
import styles from './LibraryView.module.css';

/**
 * "Diunduh" — every song saved for offline, in one place, regardless of whether it was downloaded from its own
 * "⋯" menu, from Now Playing, or in bulk from a playlist's own download button (downloadManager tracks by song
 * id alone, not by where the download happened). A song's own "⋯" menu already offers "Hapus Unduhan" — reused
 * here as-is (SongRowActions) rather than a bespoke delete control, and downloadManager.subscribe (via
 * useSongDownload inside that menu) is what makes a row disappear from this exact list the moment it's removed.
 */
export function DownloadedSongsList() {
  const [records, setRecords] = useState<DownloadRecord[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void downloadManager.list().then((list) => {
        if (!cancelled) setRecords(list);
      });
    };
    refresh();
    const unsubscribe = downloadManager.subscribe(refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const songs = records?.map((record) => record.song) ?? [];

  return (
    <>
      <CollectionHero kind="Koleksi" title="Diunduh" songs={songs} images={songs[0]?.image ?? []} fallbackIcon="download" iconCover isLoading={records === null} />
      {records && records.length === 0 ? (
        <p className={styles.empty}>Lagu yang kamu unduh untuk offline akan muncul di sini.</p>
      ) : (
        <SongTable>
          {songs.map((song, index) => (
            <SongRow key={song.id} song={song} onClick={() => playSongList(songs, index)} trailing={<SongRowActions song={song} />} />
          ))}
        </SongTable>
      )}
    </>
  );
}
