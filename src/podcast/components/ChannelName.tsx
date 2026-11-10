import type { KeyboardEvent, MouseEvent } from 'react';
import { useUiStore } from '../../stores/uiStore';
import type { Episode } from '../types';
import styles from './Podcast.module.css';

/**
 * An episode's channel name under its title (cards, rows, the overview's lists) as a way to that channel's page, like
 * the channel under a YouTube video. `nested`: the name sits inside the row's own play button, where a second <button>
 * isn't allowed, so it is a span that handles the click itself and keeps it from also starting the episode (from the
 * keyboard, the row's ⋯ menu has "channel" too). A channel without an id stays plain text.
 */
export function ChannelName({ episode, nested = false }: { episode: Episode; nested?: boolean }) {
  const openChannel = useUiStore((state) => state.openPodcastChannel);
  if (!episode.channelName) return null;
  if (!episode.channelId) return <>{episode.channelName}</>;
  const channelId = episode.channelId;
  const name = episode.channelName;
  const open = (event: MouseEvent | KeyboardEvent) => {
    event.stopPropagation();
    event.preventDefault();
    openChannel({ channelId, name });
  };
  if (nested) {
    return (
      <span className={styles.channelLink} onClick={open}>
        {name}
      </span>
    );
  }
  return (
    <button type="button" className={styles.channelLink} onClick={open}>
      {name}
    </button>
  );
}
