import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon/Icon';
import { Skeleton } from '../../components/Skeleton/Skeleton';
import { useT } from '../../i18n/i18n';
import { useUiStore, type DetailRoute } from '../../stores/uiStore';
import detail from '../../views/detail/Detail.module.css';
import { EpisodeRow, usePlayEpisode } from '../components/EpisodeRow';
import styles from '../components/Podcast.module.css';
import { podcastApi } from '../podcastApi';
import type { SeriesPage } from '../types';

/** One of a channel's playlists ("Seri"), in the playlist's own order: "Berikutnya" follows it, so a serial stays in order. */
export function PodcastSeriesView({ route }: { route: Extract<DetailRoute, { type: 'podcastSeries' }> }) {
  const t = useT();
  const closeDetail = useUiStore((state) => state.closeDetail);
  const openChannel = useUiStore((state) => state.openPodcastChannel);
  const play = usePlayEpisode();
  const [page, setPage] = useState<SeriesPage | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    podcastApi
      .series(route.seriesId)
      .then((data) => alive && setPage(data))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [route.seriesId]);

  const loadMore = () => {
    if (!page?.more || busy) return;
    setBusy(true);
    podcastApi
      .more(page.more, page.channelId, page.channelName)
      .then((next) => setPage({ ...page, episodes: [...page.episodes, ...next.episodes], more: next.more }))
      .catch(() => {})
      .finally(() => setBusy(false));
  };

  return (
    <div className={styles.view}>
      <button type="button" className={detail.backButton} style={{ position: 'static' }} onClick={closeDetail} aria-label={t('Kembali')}>
        <Icon name="chevron-left" size={18} />
      </button>
      <h1 className={styles.channelTitle}>{page?.title || route.title || ''}</h1>
      {page?.channelId && (
        <button
          type="button"
          className={styles.channelRow}
          onClick={() => openChannel({ channelId: page.channelId!, name: page.channelName ?? undefined })}
        >
          <span className={styles.channelMeta}>{page.channelName}</span>
        </button>
      )}
      {failed ? (
        <p className={styles.status}>{t('Seri ini belum bisa dimuat. Coba lagi sebentar lagi.')}</p>
      ) : !page ? (
        Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={72} borderRadius="var(--radius-md)" />)
      ) : (
        <>
          {page.episodes[0] && (
            <div className={styles.headerActions}>
              <button type="button" className={[styles.pillButton, styles.pillPrimary].join(' ')} onClick={() => play(page.episodes[0], page.episodes)}>
                <Icon name="play" size={16} />
                {t('Putar dari awal')}
              </button>
            </div>
          )}
          <div className={styles.episodeList}>
            {page.episodes.map((e) => (
              <EpisodeRow key={e.id} episode={e} list={page.episodes} />
            ))}
            {page.more && (
              <button type="button" className={styles.moreButton} onClick={loadMore} disabled={busy}>
                {busy ? t('Memuat...') : t('Muat lagi')}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
