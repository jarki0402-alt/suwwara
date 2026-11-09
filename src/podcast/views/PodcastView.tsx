import { useEffect, useState } from 'react';
import { SearchClearButton } from '../../components/SearchClearButton/SearchClearButton';
import { Icon } from '../../components/Icon/Icon';
import { Skeleton } from '../../components/Skeleton/Skeleton';
import { useT } from '../../i18n/i18n';
import { useUiStore } from '../../stores/uiStore';
import { ChannelCard } from '../components/ChannelCard';
import { EpisodeCard } from '../components/EpisodeCard';
import { EpisodeRow } from '../components/EpisodeRow';
import { PodcastHero } from '../components/PodcastHero';
import { Shelf } from '../../views/home/Shelf';
import { usePodcastHome } from '../usePodcastHome';
import styles from '../components/Podcast.module.css';
import { podcastApi } from '../podcastApi';
import { usePodcastStore } from '../podcastStore';
import type { ChannelHit, Episode } from '../types';
import { useYtText } from '../ytText';

const SEARCH_DEBOUNCE_MS = 450;

type Load<T> = { status: 'idle' } | { status: 'loading' } | { status: 'error' } | { status: 'ok'; data: T };

/** The Podcast tab: find a channel, pick up where you left off, see what's new from the ones you follow. */
export function PodcastView() {
  const t = useT();
  const [query, setQuery] = useState('');
  const trimmed = query.trim();
  return (
    <div className={styles.view}>
      <h1 className={styles.pageTitle}>{t('Podcast')}</h1>
      <label className={styles.searchBox}>
        <Icon name="search" size={18} />
        <input
          className={styles.searchInput}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('Cari channel atau episode')}
          aria-label={t('Cari channel atau episode')}
          enterKeyHint="search"
        />
        {query && <SearchClearButton onClear={() => setQuery('')} className={styles.clearButton} />}
      </label>
      {trimmed ? <SearchResults query={trimmed} /> : <PodcastHome />}
    </div>
  );
}

export function ChannelList({ channels }: { channels: { id: string; name: string; avatar: string; subscribers?: string }[] }) {
  const openChannel = useUiStore((state) => state.openPodcastChannel);
  const yt = useYtText();
  return (
    <div className={styles.episodeList}>
      {channels.map((c) => (
        <button key={c.id} type="button" className={styles.channelRow} onClick={() => openChannel({ channelId: c.id, name: c.name })}>
          <img className={styles.avatar} src={c.avatar} alt="" loading="lazy" />
          <span className={styles.channelText}>
            <span className={styles.channelName}>{c.name}</span>
            {c.subscribers && <span className={styles.channelMeta}>{yt(c.subscribers)}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

function SearchResults({ query }: { query: string }) {
  const t = useT();
  const [state, setState] = useState<Load<{ channels: ChannelHit[]; episodes: Episode[] }>>({ status: 'loading' });
  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    const timer = setTimeout(() => {
      podcastApi
        .search(query)
        .then((data) => alive && setState({ status: 'ok', data }))
        .catch(() => alive && setState({ status: 'error' }));
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query]);

  if (state.status === 'loading' || state.status === 'idle') return <ListSkeleton />;
  if (state.status === 'error') return <p className={styles.status}>{t('Pencarian gagal. Coba lagi sebentar lagi.')}</p>;
  const { channels, episodes } = state.data;
  if (channels.length === 0 && episodes.length === 0) return <p className={styles.status}>{t('Tidak ada hasil untuk "{q}".', { q: query })}</p>;
  return (
    <>
      {channels.length > 0 && (
        <Shelf title={t('Channel')}>
          {channels.map((c) => (
            <ChannelCard key={c.id} id={c.id} name={c.name} avatar={c.avatar} subscribers={c.subscribers} />
          ))}
        </Shelf>
      )}
      {episodes.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t('Episode')}</h2>
          <div className={styles.episodeList}>
            {episodes.map((e) => (
              <EpisodeRow key={e.id} episode={e} list={episodes} showChannel />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function ListSkeleton() {
  return (
    <div className={styles.episodeList}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Skeleton key={i} height={72} borderRadius="var(--radius-md)" />
      ))}
    </div>
  );
}

function PodcastHome() {
  const t = useT();
  const follows = usePodcastStore((state) => state.follows);
  const saved = usePodcastStore((state) => state.saved);
  const { continuing, newEpisodes, similar, picks } = usePodcastHome();
  const [hero, ...rest] = continuing;
  const restList = rest.map((p) => p.episode);
  const nothingYet = follows.length === 0 && continuing.length === 0;

  return (
    <>
      {hero && <PodcastHero progress={hero} list={continuing} />}
      {nothingYet && (
        <p className={styles.status}>
          {t('Cari channel favoritmu, misalnya storyteller atau podcast, lalu ikuti untuk dapat episode barunya di sini. Didengar suaranya saja, tetap jalan di background.')}
        </p>
      )}

      {rest.length > 0 && (
        <Shelf title={t('Lanjutkan')}>
          {rest.map((p) => (
            <EpisodeCard key={p.episode.id} episode={p.episode} list={restList} />
          ))}
        </Shelf>
      )}

      {follows.length > 0 &&
        (newEpisodes === null ? (
          <ListSkeleton />
        ) : newEpisodes.length > 0 ? (
          <Shelf title={t('Episode baru')} hint={t('Dari channel yang kamu ikuti')}>
            {newEpisodes.slice(0, 20).map((e) => (
              <EpisodeCard key={e.id} episode={e} list={newEpisodes} />
            ))}
          </Shelf>
        ) : null)}

      {similar.length > 0 && (
        <Shelf title={t('Mirip yang kamu dengar')}>
          {similar.map((e) => (
            <EpisodeCard key={e.id} episode={e} list={similar} />
          ))}
        </Shelf>
      )}

      {follows.length > 0 && (
        <Shelf title={t('Diikuti')}>
          {follows.map((f) => (
            <ChannelCard key={f.channelId} id={f.channelId} name={f.name} avatar={f.avatar} />
          ))}
        </Shelf>
      )}

      {saved.length > 0 && (
        <Shelf title={t('Disimpan untuk nanti')}>
          {saved.map((e) => (
            <EpisodeCard key={e.id} episode={e} list={saved} />
          ))}
        </Shelf>
      )}

      {picks.length > 0 && (
        <Shelf title={t('Pilihan')}>
          {picks.map((p) => (
            <ChannelCard key={p.channelId} id={p.channelId} name={p.name} avatar={p.avatar} subscribers={p.subscribers} />
          ))}
        </Shelf>
      )}
    </>
  );
}
