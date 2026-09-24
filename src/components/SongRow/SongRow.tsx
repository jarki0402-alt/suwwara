import type { ReactNode } from 'react';
import type { Song } from '../../api/types';
import { useUiStore } from '../../stores/uiStore';
import { formatAddedDate, formatCount } from '../../utils/formatCount';
import { useSongDuration } from '../../utils/songDurations';
import { formatTime } from '../../utils/formatTime';
import { ArtistLinks } from '../ArtistLinks/ArtistLinks';
import { Icon } from '../Icon/Icon';
import { LazyImage } from '../Image/LazyImage';
import styles from './SongRow.module.css';

// Only a real YouTube Music release id opens an album page; older saved songs carry the album NAME in that slot.
const ALBUM_ID_PATTERN = /^MPREb_/;

interface SongRowProps {
  song: Song;
  onClick: () => void;
  /** Fired the moment a finger/pointer lands on the row — a head start on whatever the tap will need. */
  onWarm?: () => void;
  isActive?: boolean;
  subtitle?: string;
  trailing?: ReactNode;
  /** Inside a SongTable (playlist, Lagu Disukai): adds the Album and Tanggal ditambahkan columns. `addedAt` is when it was saved, if known. */
  table?: { addedAt?: number };
  /** Artist page: how often the song was played (rounded — YouTube Music only reports a short figure like "312M"). */
  plays?: number;
}

export function SongRow({ song, onClick, onWarm, isActive, subtitle, trailing, table, plays }: SongRowProps) {
  const openAlbum = useUiStore((state) => state.openAlbum);
  const album = song.album;
  const duration = useSongDuration(song);

  return (
    <div className={[styles.row, isActive ? styles.active : '', table ? styles.rowTable : ''].filter(Boolean).join(' ')}>
      <button type="button" className={styles.main} onClick={onClick} onPointerDown={onWarm}>
        <LazyImage images={song.image} quality="50x50" alt={song.name} className={styles.thumb} />
        <span className={styles.text}>
          <span className={styles.title}>{song.name}</span>
          <span className={styles.subtitle}>{subtitle ?? <ArtistLinks song={song} />}</span>
        </span>
      </button>
      {table && (
        <span className={styles.colAlbum}>
          {album && ALBUM_ID_PATTERN.test(album.id) ? (
            <button type="button" className={styles.albumLink} onClick={() => openAlbum(album.id)}>
              {album.name}
            </button>
          ) : (
            (album?.name ?? '—')
          )}
        </span>
      )}
      {table && <span className={styles.colDate}>{table.addedAt ? formatAddedDate(table.addedAt) : '—'}</span>}
      {plays !== undefined && <span className={styles.plays}>{formatCount(plays)}</span>}
      {/* Rendered even when empty so a song without a duration does not shift the columns after it. */}
      <span className={styles.duration}>{duration > 0 ? formatTime(duration) : ''}</span>
      {trailing && <span className={styles.trailing}>{trailing}</span>}
    </div>
  );
}

/**
 * A song list with column headers — Judul, Album, Tanggal ditambahkan, duration — the way Spotify lays out a playlist.
 * Which columns show depends on the width of the LIST (a container query), not the window: with a right-hand panel
 * open the page is narrower than the window, so the date goes first, then the album. On a phone only the title stays.
 */
export function SongTable({ children }: { children: ReactNode }) {
  return (
    <div className={styles.tableWrap}>
      <div className={styles.table}>
        <div className={styles.tableHead} aria-hidden="true">
          <span>Judul</span>
          <span className={styles.headAlbum}>Album</span>
          <span className={styles.headDate}>Tanggal ditambahkan</span>
          <span className={styles.headDuration}>
            <Icon name="clock" size={16} />
          </span>
          <span />
        </div>
        {children}
      </div>
    </div>
  );
}
