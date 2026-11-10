import { useEffect, useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon/Icon';
import { Skeleton } from '../../components/Skeleton/Skeleton';
import { useT } from '../../i18n/i18n';
import { useUiStore, type DetailRoute } from '../../stores/uiStore';
import detail from '../../views/detail/Detail.module.css';
import { EpisodeRow, usePlayEpisode } from '../components/EpisodeRow';
import styles from '../components/Podcast.module.css';
import { podcastApi } from '../podcastApi';
import { usePodcastStore } from '../podcastStore';
import type { ChannelPage, Episode, Series } from '../types';
import { useYtText } from '../ytText';
import { usePageTint } from '../../hooks/useImageTint';

type Tab = 'latest' | 'popular' | 'series';
interface List {
  episodes: Episode[];
  more: string | null;
}

/** A YouTube channel as a podcast show: banner, follow, its videos (newest or most watched) and playlists. */
export function PodcastChannelView({ route }: { route: Extract<DetailRoute, { type: 'podcastChannel' }> }) {
  const t = useT();
  const closeDetail = useUiStore((state) => state.closeDetail);
  const [page, setPage] = useState<ChannelPage | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    podcastApi
      .channel(route.channelId)
      .then((data) => alive && setPage(data))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [route.channelId]);

  const back = (
    <button type="button" className={[detail.backButton, styles.bannerBack].join(' ')} onClick={closeDetail} aria-label={t('Kembali')}>
      <Icon name="chevron-left" size={18} />
    </button>
  );

  if (failed) {
    return (
      <div className={styles.view}>
        {back}
        <p className={styles.status}>{t('Channel ini belum bisa dimuat. Coba lagi sebentar lagi.')}</p>
      </div>
    );
  }
  if (!page) {
    return (
      <div>
        <div className={styles.banner}>
          <span className={styles.bannerPlaceholder} />
          {back}
        </div>
        <div className={styles.view}>
          <h1 className={styles.channelTitle}>{route.name ?? ''}</h1>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} height={72} borderRadius="var(--radius-md)" />
          ))}
        </div>
      </div>
    );
  }
  return <ChannelBody page={page} back={back} />;
}

function ChannelBody({ page, back }: { page: ChannelPage; back: ReactNode }) {
  const t = useT();
  const yt = useYtText();
  const play = usePlayEpisode();
  const following = usePodcastStore((state) => state.isFollowing(page.id));
  const toggleFollow = usePodcastStore((state) => state.toggleFollow);
  const openSeries = useUiStore((state) => state.openPodcastSeries);
  const [tab, setTab] = useState<Tab>('latest');
  const [latest, setLatest] = useState<List>({ episodes: page.episodes, more: page.more });
  const [popular, setPopular] = useState<List | null>(null);
  const [series, setSeries] = useState<Series[] | null>(null);
  const [busy, setBusy] = useState(false);
  // The page takes the banner's colour (or the photo's, for a channel without a banner), like an artist's page.
  usePageTint(page.banner || page.avatar || null);

  useEffect(() => {
    if (tab === 'popular' && !popular && page.popular) {
      setBusy(true);
      podcastApi
        .more(page.popular, page.id, page.name)
        .then(setPopular)
        .catch(() => setPopular({ episodes: [], more: null }))
        .finally(() => setBusy(false));
    }
    if (tab === 'series' && !series && page.seriesParams) {
      setBusy(true);
      podcastApi
        .seriesList(page.id, page.seriesParams)
        .then(setSeries)
        .catch(() => setSeries([]))
        .finally(() => setBusy(false));
    }
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = tab === 'popular' ? popular : latest;
  const setList = tab === 'popular' ? setPopular : setLatest;
  const loadMore = () => {
    if (!list?.more || busy) return;
    setBusy(true);
    podcastApi
      .more(list.more, page.id, page.name)
      .then((next) => setList({ episodes: [...list.episodes, ...next.episodes.filter((e) => !list.episodes.some((x) => x.id === e.id))], more: next.more }))
      .catch(() => {})
      .finally(() => setBusy(false));
  };

  return (
    <div>
      <div className={styles.banner}>
        {page.banner ? <img src={page.banner} alt="" /> : <span className={styles.bannerPlaceholder} />}
        {back}
      </div>
      <div className={styles.view}>
        <div className={styles.channelHeader}>
          {page.avatar && <img className={styles.avatar} src={page.avatar} alt="" />}
          <div className={styles.channelText}>
            <h1 className={styles.channelTitle}>{page.name}</h1>
            <span className={styles.channelMeta}>{[page.handle, yt(page.subscribers)].filter(Boolean).join(' · ')}</span>
          </div>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={[styles.pillButton, following ? '' : styles.pillPrimary].join(' ')}
            onClick={() => toggleFollow({ channelId: page.id, name: page.name, avatar: page.avatar })}
            aria-pressed={following}
          >
            <Icon name={following ? 'check' : 'plus'} size={16} />
            {following ? t('Diikuti') : t('Ikuti')}
          </button>
          {latest.episodes[0] && (
            <button type="button" className={styles.pillButton} onClick={() => play(latest.episodes[0], latest.episodes)}>
              <Icon name="play" size={16} />
              {t('Putar terbaru')}
            </button>
          )}
        </div>

        <div className={styles.tabs} role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'latest'} className={[styles.tab, tab === 'latest' ? styles.tabActive : ''].join(' ')} onClick={() => setTab('latest')}>
            {t('Terbaru')}
          </button>
          {page.popular && (
            <button type="button" role="tab" aria-selected={tab === 'popular'} className={[styles.tab, tab === 'popular' ? styles.tabActive : ''].join(' ')} onClick={() => setTab('popular')}>
              {t('Populer')}
            </button>
          )}
          {page.seriesParams && (
            <button type="button" role="tab" aria-selected={tab === 'series'} className={[styles.tab, tab === 'series' ? styles.tabActive : ''].join(' ')} onClick={() => setTab('series')}>
              {t('Seri')}
            </button>
          )}
        </div>

        {tab === 'series' ? (
          !series ? (
            <Skeleton height={160} borderRadius="var(--radius-md)" />
          ) : series.length === 0 ? (
            <p className={styles.status}>{t('Channel ini belum punya seri.')}</p>
          ) : (
            <div className={styles.seriesGrid}>
              {series.map((s) => (
                <button key={s.id} type="button" className={styles.seriesCard} onClick={() => openSeries({ seriesId: s.id, title: s.title })}>
                  <span className={styles.thumb}>{s.thumbnail && <img src={s.thumbnail} alt="" loading="lazy" />}</span>
                  <span className={styles.episodeTitle}>{s.title}</span>
                  <span className={styles.episodeMeta}>{yt(s.countText)}</span>
                </button>
              ))}
            </div>
          )
        ) : !list ? (
          <Skeleton height={160} borderRadius="var(--radius-md)" />
        ) : list.episodes.length === 0 ? (
          <p className={styles.status}>{t('Belum ada episode yang bisa didengar di sini.')}</p>
        ) : (
          <div className={styles.episodeList}>
            {list.episodes.map((e) => (
              <EpisodeRow key={e.id} episode={e} list={list.episodes} />
            ))}
            {list.more && (
              <button type="button" className={styles.moreButton} onClick={loadMore} disabled={busy}>
                {busy ? t('Memuat...') : t('Muat lagi')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
