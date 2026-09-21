import type { Song } from '../api/types';

/** "12 lagu · 45 mnt", "1 lagu · 3 mnt", "0 lagu". */
export function collectionMeta(songs: Song[]): string {
  const minutes = Math.round(songs.reduce((total, song) => total + (song.duration || 0), 0) / 60);
  const count = `${songs.length} lagu`;
  if (songs.length === 0 || minutes === 0) return count;
  const duration = minutes >= 60 ? `${Math.floor(minutes / 60)} j ${minutes % 60} mnt` : `${minutes} mnt`;
  return `${count} · ${duration}`;
}
