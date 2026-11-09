import { useMemo } from 'react';
import { useT } from '../../i18n/i18n';
import { useUiStore } from '../../stores/uiStore';
import { Shelf } from '../../views/home/Shelf';
import { usePodcastStore } from '../podcastStore';
import type { Episode } from '../types';
import { usePodcastHome } from '../usePodcastHome';
import { EpisodeCard } from './EpisodeCard';
import { PodcastHero } from './PodcastHero';
import styles from './PodcastHomeShelf.module.css';

const LIMIT = 12;

/**
 * Beranda's podcast part, only for someone who has listened to an episode: the one they are in the middle of (as the
 * Podcast tab's hero), then new episodes from the channels they follow and episodes like the ones they heard. Never
 * shown to someone who only listens to music: Beranda stays theirs.
 */
export function PodcastHomeShelf() {
  const hasListened = usePodcastStore((state) => Object.keys(state.progress).length > 0);
  if (!hasListened) return null;
  return <PodcastHomeBody />;
}

function PodcastHomeBody() {
  const t = useT();
  const setView = useUiStore((state) => state.setView);
  const { continuing, newEpisodes, similar } = usePodcastHome();
  const [hero] = continuing;
  const episodes = useMemo(() => {
    const seen = new Set<string>(hero ? [hero.episode.id] : []);
    const all: Episode[] = [...continuing.slice(1).map((p) => p.episode), ...(newEpisodes ?? []).slice(0, 6), ...similar];
    return all.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true))).slice(0, LIMIT);
  }, [hero, continuing, newEpisodes, similar]);

  if (!hero && episodes.length === 0) return null;
  return (
    <section className={styles.section}>
      <div className={styles.headingRow}>
        <h2 className={styles.heading}>{t('Podcast')}</h2>
        <button type="button" className={styles.seeAll} onClick={() => setView('podcast')}>
          {t('Buka Podcast')}
        </button>
      </div>
      {hero && (
        <div className={styles.hero}>
          <PodcastHero progress={hero} list={continuing} />
        </div>
      )}
      {episodes.length > 0 && (
        <Shelf title={t('Podcast untukmu')} hint={t('Episode baru dari channel yang kamu ikuti dan yang mirip dengan yang kamu dengar')}>
          {episodes.map((e) => (
            <EpisodeCard key={e.id} episode={e} list={episodes} />
          ))}
        </Shelf>
      )}
    </section>
  );
}
