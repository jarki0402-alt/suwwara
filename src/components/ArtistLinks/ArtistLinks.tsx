import type { KeyboardEvent, MouseEvent } from 'react';
import type { Song } from '../../api/types';
import { useUiStore } from '../../stores/uiStore';
import styles from './ArtistLinks.module.css';

/**
 * A song's artist name(s) as tappable links to the artist page. They are rendered as
 * role="link" spans, not <a>/<button>, because nearly every place a song's artist appears
 * lives inside a row that is itself a <button> (SongRow, MiniPlayer, queue items, cards) and
 * interactive elements can't nest inside a button. stopPropagation is what keeps a tap on the
 * name from also triggering the row's own action (playing the song).
 */
export function ArtistLinks({ song }: { song: Song }) {
  const openArtist = useUiStore((state) => state.openArtist);
  const artists = song.artists.primary;
  if (artists.length === 0) return <>Unknown Artist</>;

  return (
    <>
      {artists.map((artist, index) => {
        const open = (event: MouseEvent | KeyboardEvent) => {
          event.stopPropagation();
          event.preventDefault();
          openArtist({ artistId: artist.browseId, name: artist.name });
        };
        return (
          <span key={`${artist.name}-${index}`}>
            {index > 0 && ', '}
            <span
              role="link"
              tabIndex={0}
              className={styles.link}
              onClick={open}
              onKeyDown={(event) => {
                if (event.key === 'Enter') open(event);
              }}
            >
              {artist.name}
            </span>
          </span>
        );
      })}
    </>
  );
}
