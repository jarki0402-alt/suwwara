import { Icon } from '../../components/Icon/Icon';
import { useT } from '../../i18n/i18n';
import type { Progress } from '../types';
import { EpisodeMenu, formatEpisodeLength, usePlayEpisode } from './EpisodeRow';
import styles from './PodcastHero.module.css';

/** The top of the Podcast tab: the episode you were in the middle of, big, one tap from carrying on. */
export function PodcastHero({ progress, list }: { progress: Progress; list: Progress[] }) {
  const t = useT();
  const play = usePlayEpisode();
  const { episode } = progress;
  const fraction = progress.durationSec > 0 ? Math.min(1, progress.positionSec / progress.durationSec) : 0;
  return (
    <section className={styles.hero}>
      <img className={styles.backdrop} src={episode.thumbnail} alt="" aria-hidden="true" />
      <button type="button" className={styles.art} onClick={() => play(episode, list.map((p) => p.episode))}>
        <img src={episode.thumbnail} alt="" />
      </button>
      <div className={styles.body}>
        <span className={styles.kicker}>{t('Lanjutkan')}</span>
        <h2 className={styles.title}>{episode.title}</h2>
        <span className={styles.channel}>{episode.channelName}</span>
        <div className={styles.progressRow}>
          <span className={styles.track}>
            <span style={{ width: `${fraction * 100}%` }} />
          </span>
          <span className={styles.left}>{t('Sisa {time}', { time: formatEpisodeLength(progress.durationSec - progress.positionSec) })}</span>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.play} onClick={() => play(episode, list.map((p) => p.episode))}>
            <Icon name="play" size={18} />
            {t('Lanjutkan')}
          </button>
          <EpisodeMenu episode={episode} />
        </div>
      </div>
    </section>
  );
}
