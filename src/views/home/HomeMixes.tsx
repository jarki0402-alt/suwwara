import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { Song } from '../../api/types';
import { Icon } from '../../components/Icon/Icon';
import { playSongList } from '../../playback/playSongList';
import { getTimeMix } from '../../recommendation/smartMixes';
import { useUiStore } from '../../stores/uiStore';
import { coverLines, homeMixCards, type MixCard, type MixFilter } from './mixCatalog';
import styles from './HomeMixes.module.css';

/** A mix's cover, drawn rather than fetched: its colour, its name on two lines, and a round shape in the corner. */
export function MixCover({ card, size = 'card' }: { card: MixCard; size?: 'card' | 'tile' | 'hero' }) {
  const [first, second] = coverLines(card.title);
  const style = { '--mix-color': card.color, '--mix-shape': card.shape ?? 'var(--color-accent)' } as CSSProperties;
  return (
    <span className={[styles.cover, styles[`cover_${size}`]].join(' ')} style={style} aria-hidden="true">
      {size !== 'tile' && (
        <span className={styles.coverText}>
          {first}
          {second && <br />}
          {second}
        </span>
      )}
      <span className={styles.coverShape} />
    </span>
  );
}

const FILTERS: { id: MixFilter; label: string }[] = [
  { id: 'all', label: 'Untukmu' },
  { id: 'chill', label: 'Santai' },
  { id: 'focus', label: 'Fokus' },
  { id: 'new', label: 'Baru' },
];

/** The mood chips (phone, under the greeting). They narrow the "Dibuat untukmu" shelf below. */
export function MixFilterChips({ value, onChange }: { value: MixFilter; onChange: (value: MixFilter) => void }) {
  return (
    <div className={styles.chips} role="tablist" aria-label="Saring mix">
      {FILTERS.map((filter) => (
        <button
          key={filter.id}
          type="button"
          role="tab"
          aria-selected={value === filter.id}
          className={[styles.chip, value === filter.id ? styles.chipActive : ''].join(' ')}
          onClick={() => onChange(filter.id)}
        >
          {filter.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Phone only: the time-of-day mix as a big card with its own play button. Its songs are fetched as soon as Home shows
 * (one cached build a day) so the play button can start them inside the tap itself, which iOS needs to allow audio;
 * until they are there the button opens the mix instead.
 */
export function TimeMixHero({ card }: { card: MixCard }) {
  const openCollection = useUiStore((state) => state.openCollection);
  const [songs, setSongs] = useState<Song[]>([]);
  useEffect(() => {
    let cancelled = false;
    getTimeMix()
      .then((result) => {
        if (!cancelled) setSongs(result);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const play = () => (songs.length > 0 ? playSongList(songs, 0) : openCollection(card.id));
  return (
    <section className={styles.hero} aria-label={card.title}>
      <button type="button" className={styles.heroMain} onClick={() => openCollection(card.id)}>
        <MixCover card={card} size="hero" />
        <span className={styles.heroText}>
          <span className={styles.heroEyebrow}>Dibuat untukmu</span>
          <span className={styles.heroTitle}>{card.title}</span>
          <span className={styles.heroSub}>{card.subtitle}</span>
        </span>
      </button>
      <button type="button" className={styles.heroPlay} onClick={play} aria-label={`Putar ${card.title}`}>
        <Icon name="play" size={22} />
      </button>
    </section>
  );
}

/** "Dibuat untukmu": every mix as a card with its drawn cover. A sideways row on a phone, a wrapping grid on desktop. */
export function MixShelf({ cards }: { cards: MixCard[] }) {
  const openCollection = useUiStore((state) => state.openCollection);
  if (cards.length === 0) return null;
  return (
    <section className={styles.shelf}>
      <h2 className={styles.heading}>Dibuat untukmu</h2>
      <div className={styles.row}>
        {cards.map((card) => (
          <button key={card.id} type="button" className={styles.card} onClick={() => openCollection(card.id)}>
            <MixCover card={card} />
            <span className={styles.cardTitle}>{card.title}</span>
            <span className={styles.cardSub}>{card.subtitle}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/** The phone's hero card and the shelf, narrowed by the chips (which Home places above the shortcut tiles). */
export function HomeMixes({ filter }: { filter: MixFilter }) {
  const cards = useMemo(() => homeMixCards(), []);
  const shown = filter === 'all' ? cards : cards.filter((card) => card.filters.includes(filter));
  const hero = cards[0];
  return (
    <>
      {filter === 'all' && hero && (
        <div className={styles.phoneOnly}>
          <TimeMixHero card={hero} />
        </div>
      )}
      <MixShelf cards={shown} />
    </>
  );
}
