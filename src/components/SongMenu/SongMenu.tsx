import { useState } from 'react';
import { primaryArtistNames } from '../../api/mappers';
import type { Song } from '../../api/types';
import { downloadManager } from '../../downloads/downloadManager';
import { useSongDownload } from '../../downloads/useSongDownload';
import { enqueueSong } from '../../playback/enqueueSong';
import { playSongRadio } from '../../playback/playSongRadio';
import { useT } from '../../i18n/i18n';
import { useLibraryStore } from '../../stores/libraryStore';
import { useUiStore } from '../../stores/uiStore';
import { AddToPlaylistSheet } from '../AddToPlaylistSheet/AddToPlaylistSheet';
import { LazyImage } from '../Image/LazyImage';
import { OptionsMenu } from '../OptionsMenu/OptionsMenu';
import { useToast } from '../Toast/ToastProvider';
import styles from './SongMenu.module.css';

/** YT Music album ids. Songs saved before albums were tracked carry the album *name* here — no page to open for those. */
const ALBUM_ID = /^MPREb_/;
const MAX_ARTIST_ENTRIES = 3;

interface SongMenuProps {
  song: Song;
  /** Set where the row belongs to a user playlist: adds "Hapus dari playlist ini" to the menu. */
  onRemoveFromPlaylist?: () => void;
  /** Set where the row is a song in the play queue: adds "Hapus dari Antrean" to the menu. */
  onRemoveFromQueue?: () => void;
}

/**
 * The "⋯" menu of a song row — the same actions everywhere a song is listed. Essentials of what Spotify offers:
 * play next / add to queue, like, add to playlist (or remove from this one), song radio, go to artist / album, share.
 */
export function SongMenu({ song, onRemoveFromPlaylist, onRemoveFromQueue }: SongMenuProps) {
  const t = useT();
  const isLiked = useLibraryStore((state) => state.isLiked(song.id));
  const toggleLike = useLibraryStore((state) => state.toggleLike);
  const openArtist = useUiStore((state) => state.openArtist);
  const openAlbum = useUiStore((state) => state.openAlbum);
  const { showToast } = useToast();
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const { status: downloadStatus, toggle: toggleDownload } = useSongDownload(song);

  const handleDownloadToggle = async () => {
    const wasDownloaded = downloadStatus === 'downloaded';
    const result = await toggleDownload();
    if (!result.ok) {
      showToast(result.reason === 'quota' ? t('Batas unduhan sudah penuh. Hapus lagu lama di Pengaturan dulu.') : t('Gagal mengunduh lagu ini.'));
      return;
    }
    showToast(wasDownloaded ? t('Unduhan dihapus.') : t('Lagu diunduh untuk offline.'));
  };

  const artists = song.artists.primary.filter((artist, index, all) => all.findIndex((other) => other.name === artist.name) === index).slice(0, MAX_ARTIST_ENTRIES);
  const albumId = song.album?.id && ALBUM_ID.test(song.album.id) ? song.album.id : null;

  const share = async () => {
    const url = `https://music.youtube.com/watch?v=${encodeURIComponent(song.id)}`;
    const title = `${song.name} · ${primaryArtistNames(song)}`;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text: title, url });
      } catch {
        // dismissed the share sheet — nothing to report
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      showToast(t('Tautan lagu disalin.'));
    } catch {
      showToast(t('Tautan tidak bisa disalin di perangkat ini.'));
    }
  };

  const enqueue = (where: 'next' | 'end') => {
    const result = enqueueSong(song, where);
    if (result === 'playing') showToast(t('Diputar sekarang.'));
    else showToast(where === 'next' ? t('Akan diputar setelah lagu ini.') : t('Ditambahkan ke antrean.'));
  };

  return (
    <>
      <OptionsMenu
        ariaLabel={t('Opsi untuk {name}', { name: song.name })}
        header={
          <div className={styles.head}>
            <LazyImage images={song.image} quality="150x150" alt="" className={styles.headArt} />
            <span className={styles.headText}>
              <span className={styles.headTitle}>{song.name}</span>
              <span className={styles.headArtist}>{primaryArtistNames(song)}</span>
            </span>
          </div>
        }
        items={[
          { key: 'play-next', icon: 'play-next', label: t('Putar Selanjutnya'), onClick: () => enqueue('next') },
          { key: 'queue', icon: 'queue', label: t('Tambah ke Antrean'), onClick: () => enqueue('end') },
          {
            key: 'like',
            icon: isLiked ? 'heart-filled' : 'heart',
            label: isLiked ? t('Hapus dari Lagu Disukai') : t('Simpan ke Lagu Disukai'),
            onClick: () => {
              toggleLike(song);
              showToast(isLiked ? t('Dihapus dari Lagu Disukai.') : t('Disimpan ke Lagu Disukai.'));
            },
            separatorBefore: true,
          },
          { key: 'playlist', icon: 'plus', label: t('Tambah ke Playlist'), onClick: () => setPlaylistOpen(true) },
          downloadManager.isSupported && {
            key: 'download',
            icon: downloadStatus === 'downloaded' ? 'check' : 'download',
            label: downloadStatus === 'downloading' ? t('Mengunduh…') : downloadStatus === 'downloaded' ? t('Hapus Unduhan') : t('Unduh untuk Offline'),
            onClick: () => void handleDownloadToggle(),
            disabled: downloadStatus === 'checking' || downloadStatus === 'downloading',
          },
          onRemoveFromPlaylist && { key: 'remove', icon: 'trash', label: t('Hapus dari Playlist Ini'), onClick: onRemoveFromPlaylist, danger: true },
          onRemoveFromQueue && { key: 'remove-queue', icon: 'trash', label: t('Hapus dari Antrean'), onClick: onRemoveFromQueue, danger: true },
          { key: 'radio', icon: 'radio', label: t('Buka Radio Lagu'), onClick: () => playSongRadio(song), separatorBefore: true },
          ...artists.map((artist, index) => ({
            key: `artist-${index}`,
            icon: 'artist' as const,
            label: artists.length > 1 ? t('Lihat Artis · {name}', { name: artist.name }) : t('Lihat Artis'),
            onClick: () => openArtist({ artistId: artist.browseId, name: artist.name }),
          })),
          albumId ? { key: 'album', icon: 'album', label: t('Lihat Album'), onClick: () => openAlbum(albumId) } : null,
          { key: 'share', icon: 'share', label: t('Bagikan'), onClick: () => void share() },
        ]}
      />
      <AddToPlaylistSheet song={song} isOpen={playlistOpen} onClose={() => setPlaylistOpen(false)} />
    </>
  );
}
