import type { Song } from '../../api/types';
import { LikeButton } from '../LikeButton/LikeButton';
import { SongMenu } from './SongMenu';

/** The trailing end of every song row: the heart, then the "⋯" menu — same on every list, like Spotify. */
export function SongRowActions({ song, onRemoveFromPlaylist }: { song: Song; onRemoveFromPlaylist?: () => void }) {
  return (
    <>
      <LikeButton song={song} />
      <SongMenu song={song} onRemoveFromPlaylist={onRemoveFromPlaylist} />
    </>
  );
}
