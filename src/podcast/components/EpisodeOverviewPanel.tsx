import { useState } from 'react';
import type { Song } from '../../api/types';
import { Icon } from '../../components/Icon/Icon';
import { useT } from '../../i18n/i18n';
import { useUiStore } from '../../stores/uiStore';
import { queueEpisode } from '../playEpisode';
import { usePodcastStore } from '../podcastStore';
import { useToast } from '../../components/Toast/ToastProvider';
import type { Episode } from '../types';
import { useEpisodeOverview } from '../useEpisodeOverview';
import { formatEpisodeLength, usePlayEpisode } from './EpisodeRow';
import styles from './EpisodeOverviewPanel.module.css';
import { useYtText } from '../ytText';
import { ChannelName } from './ChannelName';

const DESCRIPTION_PREVIEW = 220;

/** A small episode row for the panel: tap plays, the side button queues it (or takes it out). */
function MiniEpisode({ episode, list, queued }: { episode: Episode; list: Episode[]; queued?: boolean }) {
  const t = useT();
  const yt = useYtText();
  const play = usePlayEpisode();
  const isQueued = usePodcastStore((state) => state.isQueued(episode.id));
  const removeFromQueue = usePodcastStore((state) => state.removeFromQueue);
  const { showToast } = useToast();
  const inQueue = queued || isQueued;
  const add = () => {
    if (queueEpisode(episode) === 'jam') showToast(t('Ditambahkan ke antrean Jam.'));
  };
  return (
    <div className={styles.mini}>
      <button type="button" className={styles.miniMain} onClick={() => play(episode, list)}>
        <span className={styles.miniThumb}>
          <img src={episode.thumbnail} alt="" loading="lazy" />
          {episode.durationSec > 0 && <span className={styles.miniDuration}>{formatEpisodeLength(episode.durationSec)}</span>}
        </span>
        <span className={styles.miniText}>
          <span className={styles.miniTitle}>{episode.title}</span>
          <span className={styles.miniMeta}>
            <ChannelName episode={episode} nested />
            {episode.channelName && episode.publishedText ? ' · ' : ''}
            {yt(episode.publishedText)}
          </span>
        </span>
      </button>
      <button
        type="button"
        className={[styles.queueButton, inQueue ? styles.queueButtonOn : ''].join(' ')}
        onClick={() => (inQueue ? removeFromQueue(episode.id) : add())}
        aria-label={inQueue ? t('Hapus dari antrean') : t('Tambahkan ke antrean')}
      >
        <Icon name={inQueue ? 'check' : 'play-next'} size={18} />
      </button>
    </div>
  );
}

/**
 * What is playing, as a podcast app shows it: the channel (follow it from here), the date, the description (folded:
 * it usually opens with sponsor links), what is queued next, and episodes like this one. Shown in the desktop's Now
 * Playing panel and in the queue panel (phone and desktop) whenever an episode plays.
 */
export function EpisodeOverviewPanel({ song }: { song: Song }) {
  const t = useT();
  const yt = useYtText();
  const overview = useEpisodeOverview(song.id);
  const queue = usePodcastStore((state) => state.queue);
  const following = usePodcastStore((state) => (overview?.channel ? state.isFollowing(overview.channel.id) : false));
  const toggleFollow = usePodcastStore((state) => state.toggleFollow);
  const openChannel = useUiStore((state) => state.openPodcastChannel);
  const [expanded, setExpanded] = useState(false);
  const channel = overview?.channel;
  const description = overview?.description.trim() ?? '';
  const related = (overview?.related ?? []).filter((e) => !queue.some((q) => q.id === e.id)).slice(0, 10);

  return (
    <div className={styles.panel}>
      {channel && (
        <div className={styles.channel}>
          <button type="button" className={styles.channelLink} onClick={() => openChannel({ channelId: channel.id, name: channel.name })}>
            {channel.avatar && <img className={styles.avatar} src={channel.avatar} alt="" />}
            <span className={styles.channelText}>
              <span className={styles.channelName}>{channel.name}</span>
              <span className={styles.meta}>{yt(channel.subscribers)}</span>
            </span>
          </button>
          <button
            type="button"
            className={[styles.follow, following ? '' : styles.followPrimary].join(' ')}
            onClick={() => toggleFollow({ channelId: channel.id, name: channel.name, avatar: channel.avatar })}
          >
            {following ? t('Diikuti') : t('Ikuti')}
          </button>
        </div>
      )}

      {overview && (
        <section className={styles.about}>
          <span className={styles.meta}>
            {[yt(overview.dateText), yt(overview.viewsText), song.duration > 0 ? formatEpisodeLength(song.duration) : null].filter(Boolean).join(' · ')}
          </span>
          {description && (
            <>
              <p className={styles.description}>
                {expanded || description.length <= DESCRIPTION_PREVIEW ? description : `${description.slice(0, DESCRIPTION_PREVIEW).trimEnd()}...`}
              </p>
              {description.length > DESCRIPTION_PREVIEW && (
                <button type="button" className={styles.more} onClick={() => setExpanded((v) => !v)}>
                  {expanded ? t('Lebih sedikit') : t('Selengkapnya')}
                </button>
              )}
            </>
          )}
        </section>
      )}

      <section className={styles.section}>
        <h3 className={styles.heading}>{t('Antrean podcast')}</h3>
        {queue.length === 0 ? (
          <p className={styles.meta}>{t('Episode yang kamu tambahkan diputar setelah ini selesai. Saran di bawah tidak diputar sendiri.')}</p>
        ) : (
          queue.map((e) => <MiniEpisode key={e.id} episode={e} list={queue} queued />)
        )}
      </section>

      {related.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.heading}>{t('Mirip episode ini')}</h3>
          {related.map((e) => (
            <MiniEpisode key={e.id} episode={e} list={related} />
          ))}
        </section>
      )}
    </div>
  );
}
