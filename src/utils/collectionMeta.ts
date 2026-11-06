import type { Song } from '../api/types';
import { t } from '../i18n/i18n';

/** "12 lagu · 45 mnt", "1 lagu · 3 mnt", "0 lagu" (in the current language). */
export function collectionMeta(songs: Song[]): string {
  const minutes = Math.round(songs.reduce((total, song) => total + (song.duration || 0), 0) / 60);
  const count = t('{n} lagu', { n: songs.length });
  if (songs.length === 0 || minutes === 0) return count;
  const duration = minutes >= 60 ? t('{h} j {m} mnt', { h: Math.floor(minutes / 60), m: minutes % 60 }) : t('{m} mnt', { m: minutes });
  return `${count} · ${duration}`;
}
