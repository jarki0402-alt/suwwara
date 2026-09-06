import type { ReactNode } from 'react';
import type { Song } from '../../api/types';
import { primaryArtistNames } from '../../api/mappers';
import { LazyImage } from '../Image/LazyImage';
import styles from './SongRow.module.css';

interface SongRowProps {
  song: Song;
  onClick: () => void;
  isActive?: boolean;
  subtitle?: string;
  trailing?: ReactNode;
}

export function SongRow({ song, onClick, isActive, subtitle, trailing }: SongRowProps) {
  return (
    <div className={[styles.row, isActive ? styles.active : ''].filter(Boolean).join(' ')}>
      <button type="button" className={styles.main} onClick={onClick}>
        <LazyImage images={song.image} quality="50x50" alt={song.name} className={styles.thumb} />
        <span className={styles.text}>
          <span className={styles.title}>{song.name}</span>
          <span className={styles.subtitle}>{subtitle ?? primaryArtistNames(song)}</span>
        </span>
      </button>
      {trailing && <span className={styles.trailing}>{trailing}</span>}
    </div>
  );
}
