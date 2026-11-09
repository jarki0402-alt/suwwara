import { useMemo } from 'react';
import { Icon } from '../../components/Icon/Icon';
import { LazyImage } from '../../components/Image/LazyImage';
import { useT, type Translate } from '../../i18n/i18n';
import { useLibraryStore } from '../../stores/libraryStore';
import { useUiStore, type GeneratedCollectionId, LIKED_SONGS_ID } from '../../stores/uiStore';
import { MixCover } from './HomeMixes';
import { useRequestMixArtwork } from './mixArtwork';
import { useHomeMixCards, type MixCard } from './mixCatalog';
import { recordRecentCollection, useRecentCollections, type RecentCollection } from './recentCollections';
import styles from './QuickTiles.module.css';

const TILE_COUNT = 6;

type Tile =
  | { key: string; kind: 'liked'; title: string }
  | { key: string; kind: 'playlist'; id: string; title: string; image: Parameters<typeof LazyImage>[0]['images'] | null }
  | { key: string; kind: 'mix'; card: MixCard };

function mixCardFor(id: GeneratedCollectionId, cards: MixCard[], t: Translate): MixCard {
  const known = cards.find((card) => card.id === id);
  if (known) return known;
  const name = id.startsWith('artist-mix:')
    ? t('Mix {artist}', { artist: id.slice('artist-mix:'.length) })
    : id.startsWith('radio:')
      ? t('Radio {artist}', { artist: id.slice('radio:'.length) })
      : 'Mix';
  return { id, title: name, subtitle: '', filters: [], color: '#7A3B2E', shape: '#F2B38A' };
}

/**
 * The shortcut tiles under the greeting (2026-11 redesign, Spotify's "jump back in"): what this device opened last
 * (Lagu Disukai, a playlist, a mix), topped up with Lagu Disukai, your playlists and today's mixes so the grid is
 * never half empty. Two columns on a phone, three on desktop.
 */
export function QuickTiles() {
  const t = useT();
  const recent = useRecentCollections();
  const playlists = useLibraryStore((state) => state.playlists);
  const openPlaylist = useUiStore((state) => state.openPlaylist);
  const openCollection = useUiStore((state) => state.openCollection);

  const cards = useHomeMixCards();
  const tiles = useMemo(() => {
    const out: Tile[] = [];
    const seen = new Set<string>();
    const add = (entry: RecentCollection) => {
      if (out.length >= TILE_COUNT) return;
      if (entry.type === 'liked') {
        if (seen.has('liked')) return;
        seen.add('liked');
        out.push({ key: 'liked', kind: 'liked', title: t('Lagu Disukai') });
      } else if (entry.type === 'playlist') {
        const playlist = playlists.find((item) => item.id === entry.id);
        const key = `playlist:${entry.id}`;
        if (!playlist || seen.has(key)) return; // deleted since
        seen.add(key);
        out.push({ key, kind: 'playlist', id: playlist.id, title: playlist.name, image: playlist.songs[0]?.image ?? null });
      } else {
        const key = `mix:${entry.id}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push({ key, kind: 'mix', card: mixCardFor(entry.id, cards, t) });
      }
    };
    recent.forEach(add);
    add({ type: 'liked' });
    playlists.forEach((playlist) => add({ type: 'playlist', id: playlist.id }));
    cards.forEach((card) => add({ type: 'mix', id: card.id }));
    return out;
  }, [recent, playlists, cards, t]);

  useRequestMixArtwork(tiles.flatMap((tile) => (tile.kind === 'mix' ? [tile.card.id] : [])));

  const open = (tile: Tile) => {
    if (tile.kind === 'liked') {
      recordRecentCollection({ type: 'liked' });
      openPlaylist(LIKED_SONGS_ID);
    } else if (tile.kind === 'playlist') {
      openPlaylist(tile.id);
    } else {
      openCollection(tile.card.id);
    }
  };

  return (
    <section className={styles.grid} aria-label={t('Lanjutkan')}>
      {tiles.map((tile) => (
        <button key={tile.key} type="button" className={styles.tile} onClick={() => open(tile)}>
          <span className={styles.art}>
            {tile.kind === 'liked' && (
              <span className={styles.likedArt}>
                <Icon name="heart-filled" size={22} />
              </span>
            )}
            {tile.kind === 'playlist' &&
              (tile.image ? (
                <LazyImage images={tile.image} quality="150x150" alt="" className={styles.image} />
              ) : (
                <span className={styles.placeholderArt}>
                  <Icon name="library" size={22} />
                </span>
              ))}
            {tile.kind === 'mix' && <MixCover card={tile.card} size="tile" />}
          </span>
          <span className={styles.title}>{tile.kind === 'mix' ? tile.card.title : tile.title}</span>
        </button>
      ))}
    </section>
  );
}
