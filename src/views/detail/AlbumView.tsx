import { getAlbumPage, type AlbumPageData } from '../../api/endpoints/artistPage';
import { Icon } from '../../components/Icon/Icon';
import { LazyImage } from '../../components/Image/LazyImage';
import { Skeleton } from '../../components/Skeleton/Skeleton';
import { usePageTint } from '../../hooks/useImageTint';
import { SongRow } from '../../components/SongRow/SongRow';
import { SongRowActions } from '../../components/SongMenu/SongRowActions';
import { useT } from '../../i18n/i18n';
import { playSongList } from '../../playback/playSongList';
import { useUiStore, type DetailRoute } from '../../stores/uiStore';
import styles from './Detail.module.css';
import { imagesFromUrl } from './imagesFromUrl';
import { useLoaded } from './useLoaded';

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

export function AlbumView({ route }: { route: Extract<DetailRoute, { type: 'album' }> }) {
  const t = useT();
  const closeDetail = useUiStore((state) => state.closeDetail);
  const openArtist = useUiStore((state) => state.openArtist);
  const page = useLoaded<AlbumPageData>(route.albumId, () => getAlbumPage(route.albumId));
  // The cover's colour fills the page behind it (Apple Music style); see usePageTint.
  usePageTint(page.status === 'ready' ? page.data.thumbnail : null);

  const back = (
    <div className={styles.albumBackRow}>
      <button type="button" className={styles.roundButton} onClick={closeDetail} aria-label={t('Kembali')}>
        <Icon name="chevron-left" size={18} />
      </button>
    </div>
  );

  if (page.status === 'loading') {
    return (
      <div className={styles.view}>
        <div className={styles.albumHeader}>
          {back}
          <Skeleton width="min(62vw, 240px)" height="min(62vw, 240px)" borderRadius="var(--radius-md)" />
        </div>
        <div className={styles.skeletonStack}>
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={`album-skeleton-${index}`} height={56} borderRadius="var(--radius-md)" />
          ))}
        </div>
      </div>
    );
  }

  if (page.status === 'error') {
    return (
      <div className={styles.view}>
        <div className={styles.albumHeader}>{back}</div>
        <p className={styles.status}>{t('Album ini belum bisa dimuat. Coba lagi sebentar lagi.')}</p>
      </div>
    );
  }

  const album = page.data;
  return (
    <div className={styles.view}>
      <div className={styles.albumHeader}>
        {back}
        <LazyImage images={imagesFromUrl(album.thumbnail)} quality="500x500" alt={album.name} className={styles.albumCover} />
        <h1 className={styles.albumTitle}>{album.name}</h1>
        <button type="button" className={styles.albumArtist} onClick={() => openArtist({ artistId: album.artistId, name: album.artist })}>
          {album.artist}
        </button>
        <span className={styles.albumMeta}>{[album.year, t('{n} lagu', { n: album.songs.length })].filter(Boolean).join(' · ')}</span>
        {album.songs.length > 0 && (
          <div className={styles.actions}>
            <button type="button" className={styles.playButton} onClick={() => playSongList(album.songs, 0)} aria-label={t('Putar {name}', { name: album.name })}>
              <Icon name="play" size={24} />
            </button>
            <button type="button" className={styles.roundButton} onClick={() => playSongList(shuffled(album.songs), 0)} aria-label={t('Putar acak')}>
              <Icon name="shuffle" size={22} />
            </button>
          </div>
        )}
      </div>

      <div className={[styles.body, styles.longList].join(' ')}>
        {album.songs.map((song, index) => (
          <div key={song.id} className={styles.rankedRow}>
            <span className={styles.rank}>{index + 1}</span>
            <SongRow song={song} onClick={() => playSongList(album.songs, index)} trailing={<SongRowActions song={song} />} />
          </div>
        ))}
      </div>
    </div>
  );
}
