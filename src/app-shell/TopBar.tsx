import { useEffect, useRef, useState } from 'react';
import { findArtistMatch, searchSongs, type ArtistHit } from '../api/endpoints/search';
import type { Song } from '../api/types';
import { primaryArtistNames } from '../api/mappers';
import { Icon } from '../components/Icon/Icon';
import { SongRowActions } from '../components/SongMenu/SongRowActions';
import { LazyImage } from '../components/Image/LazyImage';
import { useRecentSearches } from '../hooks/useRecentSearches';
import { playSongRadio } from '../playback/playSongRadio';
import { useUiStore } from '../stores/uiStore';
import { debounce, type Debounced } from '../utils/debounce';
import styles from './TopBar.module.css';

const DEBOUNCE_MS = 300;
const MAX_RESULTS = 8;

/**
 * Desktop search, right where you already are: type in the middle of the top bar and the results drop
 * down over the page you are on — pick one and it plays. Nothing navigates away (the Cari menu still
 * exists, and is what a phone uses). When the text is really an artist's name, the top row offers that
 * artist's profile. Hidden below the desktop
 * breakpoint, on the Cari menu itself (which has its own field), and on artist/album pages, whose
 * banner runs full-bleed to the top edge.
 */
export function TopBar() {
  const currentView = useUiStore((state) => state.currentView);
  const detailDepth = useUiStore((state) => state.detailStack.length);
  const openArtist = useUiStore((state) => state.openArtist);
  const recent = useRecentSearches();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Song[]>([]);
  const [artist, setArtist] = useState<ArtistHit | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);

  // Built in an effect (not useMemo) so the debounced callback's ref reads never happen during render.
  const runSearchRef = useRef<Debounced<[string]> | null>(null);
  useEffect(() => {
    const run = debounce((value: string) => {
      const requestId = ++requestIdRef.current;
      // Independent of the songs: the profile row appears whenever it arrives, without holding the songs back.
      findArtistMatch(value).then((hit) => {
        if (requestId === requestIdRef.current) setArtist(hit);
      });
      searchSongs(value, MAX_RESULTS)
        .then((response) => {
          if (requestId !== requestIdRef.current) return;
          setResults(response.songs.slice(0, MAX_RESULTS));
          setHighlight(-1);
        })
        .catch(() => {
          if (requestId === requestIdRef.current) setResults([]);
        })
        .finally(() => {
          if (requestId === requestIdRef.current) setIsLoading(false);
        });
    }, DEBOUNCE_MS);
    runSearchRef.current = run;
    return () => {
      run.cancel();
      runSearchRef.current = null;
    };
  }, []);

  // Click anywhere outside closes the dropdown — except inside a floating layer opened from one of its rows (a song's
  // ⋯ menu, the add-to-playlist dialog): those live in <body>, and closing the dropdown would unmount their owner.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Element;
      if (target.closest?.('[data-overlay]')) return;
      if (boxRef.current && !boxRef.current.contains(target)) setIsOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  const handleChange = (value: string) => {
    setQuery(value);
    setIsOpen(true);
    if (value.trim().length === 0) {
      runSearchRef.current?.cancel();
      requestIdRef.current += 1;
      setResults([]);
      setArtist(null);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    runSearchRef.current?.(value);
  };

  const close = () => {
    setQuery('');
    setResults([]);
    setArtist(null);
    setIsOpen(false);
    inputRef.current?.blur();
  };

  const choose = (song: Song) => {
    recent.add(query.trim());
    playSongRadio(song);
    close();
  };

  const chooseArtist = (hit: ArtistHit) => {
    recent.add(query.trim());
    openArtist({ artistId: hit.artistId, name: hit.name });
    close();
  };

  // Arrow keys walk one list: the artist row first (when there is one), then the songs.
  const rowCount = results.length + (artist ? 1 : 0);

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setIsOpen(false);
      inputRef.current?.blur();
    } else if (event.key === 'ArrowDown' && rowCount > 0) {
      event.preventDefault();
      setHighlight((value) => Math.min(value + 1, rowCount - 1));
    } else if (event.key === 'ArrowUp' && rowCount > 0) {
      event.preventDefault();
      setHighlight((value) => Math.max(value - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      // Enter with nothing highlighted plays the top SONG; the profile is only opened by choosing it.
      if (highlight < 0) {
        if (results[0]) choose(results[0]);
      } else if (artist && highlight === 0) {
        chooseArtist(artist);
      } else {
        const song = results[highlight - (artist ? 1 : 0)];
        if (song) choose(song);
      }
    }
  };

  if ((currentView === 'search' && detailDepth === 0) || detailDepth > 0) return null;

  const trimmed = query.trim();
  const showRecent = isOpen && trimmed.length === 0 && recent.items.length > 0;
  const showResults = isOpen && trimmed.length > 0;

  return (
    <div className={styles.bar}>
      <div className={styles.inner} ref={boxRef}>
        <div className={styles.field}>
          <Icon name="search" size={19} />
          <input
            ref={inputRef}
            className={styles.input}
            type="text"
            inputMode="search"
            placeholder="Cari lagu, artis, atau album…"
            value={query}
            onChange={(event) => handleChange(event.target.value)}
            onFocus={() => setIsOpen(true)}
            onKeyDown={onKeyDown}
            aria-label="Cari lagu, artis, atau album"
          />
        </div>

        {(showRecent || showResults) && (
          <div className={styles.dropdown}>
            {showRecent && (
              <>
                <div className={styles.dropdownHeader}>
                  <span className={styles.dropdownLabel}>Pencarian terakhir</span>
                  <button type="button" className={styles.clearAll} onClick={recent.clear}>
                    Hapus semua
                  </button>
                </div>
                {recent.items.map((term) => (
                  <div key={term} className={styles.recentItem}>
                    <button type="button" className={styles.recentRow} onClick={() => handleChange(term)}>
                      <Icon name="clock" size={15} />
                      {term}
                    </button>
                    <button type="button" className={styles.recentRemove} onClick={() => recent.remove(term)} aria-label={`Hapus "${term}" dari riwayat`}>
                      <Icon name="close" size={14} />
                    </button>
                  </div>
                ))}
              </>
            )}
            {showResults && isLoading && results.length === 0 && <span className={styles.status}>Mencari…</span>}
            {showResults && !isLoading && results.length === 0 && <span className={styles.status}>Tidak ada hasil untuk “{trimmed}”.</span>}
            {showResults && artist && (
              <button
                type="button"
                className={[styles.resultRow, highlight === 0 ? styles.resultRowActive : ''].join(' ')}
                onMouseEnter={() => setHighlight(0)}
                onClick={() => chooseArtist(artist)}
              >
                <LazyImage images={artist.image} quality="50x50" alt="" className={styles.artistThumb} />
                <span className={styles.resultText}>
                  <span className={styles.resultTitle}>{artist.name}</span>
                  <span className={styles.resultArtist}>Artis · Lihat profil</span>
                </span>
              </button>
            )}
            {showResults &&
              results.map((song, index) => (
                <div
                  key={song.id}
                  className={[styles.songRow, index + (artist ? 1 : 0) === highlight ? styles.resultRowActive : ''].join(' ')}
                  onMouseEnter={() => setHighlight(index + (artist ? 1 : 0))}
                >
                  <button type="button" className={styles.songMain} onClick={() => choose(song)}>
                    <LazyImage images={song.image} quality="50x50" alt="" className={styles.resultThumb} />
                    <span className={styles.resultText}>
                      <span className={styles.resultTitle}>{song.name}</span>
                      <span className={styles.resultArtist}>{primaryArtistNames(song)}</span>
                    </span>
                  </button>
                  <span className={styles.songActions}>
                    <SongRowActions song={song} />
                  </span>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
