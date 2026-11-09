import { useUiStore } from '../../stores/uiStore';
import styles from './ChannelCard.module.css';
import { useYtText } from '../ytText';

/** A channel in a shelf: round photo, name, subscribers. Opens its page. */
export function ChannelCard({ id, name, avatar, subscribers }: { id: string; name: string; avatar: string; subscribers?: string }) {
  const openChannel = useUiStore((state) => state.openPodcastChannel);
  const yt = useYtText();
  return (
    <button type="button" className={styles.card} onClick={() => openChannel({ channelId: id, name })}>
      <img className={styles.avatar} src={avatar} alt="" loading="lazy" />
      <span className={styles.name}>{name}</span>
      {subscribers && <span className={styles.meta}>{yt(subscribers)}</span>}
    </button>
  );
}
