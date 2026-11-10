import { useT } from '../../i18n/i18n';
import { formatTime } from '../../utils/formatTime';
import { usePodcastStore } from '../podcastStore';
import type { Episode } from '../types';
import { ChannelName } from './ChannelName';
import { EpisodeMenu, formatEpisodeLength, usePlayEpisode } from './EpisodeRow';
import styles from './EpisodeCard.module.css';
import { useEpisodeDate, useYtText } from '../ytText';

/** An episode as a card in a shelf: its 16:9 picture (with length and how far you got), title, channel. */
export function EpisodeCard({ episode, list }: { episode: Episode; list: Episode[] }) {
  const t = useT();
  const yt = useYtText();
  const episodeDate = useEpisodeDate();
  const play = usePlayEpisode();
  const progress = usePodcastStore((state) => state.progress[episode.id]);
  const duration = episode.durationSec || progress?.durationSec || 0;
  const fraction = progress && duration > 0 ? Math.min(1, progress.positionSec / duration) : 0;
  const note =
    progress && !progress.finished && duration > 0
      ? t('Sisa {time}', { time: formatEpisodeLength(duration - progress.positionSec) })
      : episode.publishedText
        ? yt(episode.publishedText)
        : episodeDate(episode.publishedAt);
  return (
    <div className={styles.card}>
      <button type="button" className={styles.main} onClick={() => play(episode, list)}>
        <span className={styles.thumb}>
          <img src={episode.thumbnail} alt="" loading="lazy" decoding="async" />
          {duration > 0 && <span className={styles.duration}>{formatTime(duration)}</span>}
          {fraction > 0 && (
            <span className={styles.progress} aria-hidden="true">
              <span style={{ width: `${(progress?.finished ? 1 : fraction) * 100}%` }} />
            </span>
          )}
          <span className={styles.playBadge} aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24">
              <polygon points="8,5 19,12 8,19" fill="currentColor" />
            </svg>
          </span>
        </span>
        <span className={styles.title}>{episode.title}</span>
      </button>
      <div className={styles.footer}>
        <span className={styles.meta}>
          <ChannelName episode={episode} />
          {episode.channelName && note ? ' · ' : ''}
          {note}
        </span>
        <EpisodeMenu episode={episode} />
      </div>
    </div>
  );
}
