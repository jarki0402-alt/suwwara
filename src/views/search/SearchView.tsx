import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { getCategorySongs } from '../../api/endpoints/category';
import { findArtistMatch, getSearchSuggestions, searchSongs, type ArtistHit } from '../../api/endpoints/search';
import type { Song } from '../../api/types';
import { Icon } from '../../components/Icon/Icon';
import { LazyImage } from '../../components/Image/LazyImage';
import { Skeleton } from '../../components/Skeleton/Skeleton';
import type { BrowseCategory } from '../../data/browseCategories';
import { useRecentSearches } from '../../hooks/useRecentSearches';
import { useUiStore } from '../../stores/uiStore';
import { debounce } from '../../utils/debounce';
import { BrowseCategoriesGrid } from './BrowseCategoriesGrid';
import { SearchResultsList } from './SearchResultsList';
import styles from './SearchView.module.css';

const DEBOUNCE_MS = 350;
const SUGGESTIONS_DEBOUNCE_MS = 180;
const MAX_SUGGESTIONS = 5;

export function SearchView() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Song[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [artist, setArtist] = useState<ArtistHit | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const openArtist = useUiStore((state) => state.openArtist);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [hasCommitted, setHasCommitted] = useState(false);
  const requestIdRef = useRef(0);
  // The tile currently shown (its label sits in the box). While it is, the typed-search effect below must
  // leave the results alone: it used to fire a keyword search for the label 350ms after the tile loaded and
  // overwrite the tile's songs — a tile called Pop then showed songs merely named "pop".
  const activeCategoryLabelRef = useRef<string | null>(null);
  const recentSearches = useRecentSearches();

  const performSearch = (searchQuery: string) => {
    const trimmed = searchQuery.trim();
    if (trimmed.length === 0) {
      setResults([]);
      setArtist(null);
      setIsLoading(false);
      setError(null);
      return;
    }
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);
    // Independent of the songs — the profile card shows up whenever it arrives.
    findArtistMatch(trimmed).then((hit) => {
      if (requestId === requestIdRef.current) setArtist(hit);
    });
    searchSongs(trimmed)
      .then((response) => {
        if (requestId !== requestIdRef.current) return;
        setResults(response.songs);
      })
      .catch(() => {
        if (requestId !== requestIdRef.current) return;
        setError('Gagal mencari lagu. Periksa koneksi internetmu.');
      })
      .finally(() => {
        if (requestId !== requestIdRef.current) return;
        setIsLoading(false);
      });
  };

  const runDebouncedSearch = useMemo(() => debounce((value: string) => performSearch(value), DEBOUNCE_MS), []);

  const runDebouncedSuggestions = useMemo(
    () =>
      debounce((value: string) => {
        getSearchSuggestions(value)
          .then((result) => setSuggestions(result.slice(0, MAX_SUGGESTIONS)))
          .catch(() => setSuggestions([]));
      }, SUGGESTIONS_DEBOUNCE_MS),
    [],
  );

  useEffect(() => {
    if (activeCategoryLabelRef.current !== null && activeCategoryLabelRef.current === query) return;
    runDebouncedSearch(query);
    if (query.trim().length > 0 && !hasCommitted) {
      runDebouncedSuggestions(query);
    } else {
      runDebouncedSuggestions.cancel();
      setSuggestions([]);
    }
    return () => {
      runDebouncedSearch.cancel();
      runDebouncedSuggestions.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const commitSearch = (term: string) => {
    activeCategoryLabelRef.current = null;
    setQuery(term);
    setHasCommitted(true);
    setSuggestions([]);
    runDebouncedSearch.cancel();
    performSearch(term);
    recentSearches.add(term);
  };

  const handleCategorySelect = (category: BrowseCategory) => {
    activeCategoryLabelRef.current = category.label;
    setQuery(category.label);
    setHasCommitted(true);
    setSuggestions([]);
    runDebouncedSearch.cancel();
    const requestId = ++requestIdRef.current;
    setArtist(null);
    setIsLoading(true);
    setError(null);
    getCategorySongs(category.id)
      .then((songs) => {
        if (requestId === requestIdRef.current) setResults(songs);
      })
      .catch(() => {
        if (requestId === requestIdRef.current) setError('Gagal memuat kategori. Periksa koneksi internetmu.');
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setIsLoading(false);
      });
  };

  const handleInputChange = (value: string) => {
    activeCategoryLabelRef.current = null;
    setQuery(value);
    setHasCommitted(false);
  };

  const handleOpenArtist = (hit: ArtistHit) => {
    recentSearches.add(query);
    openArtist({ artistId: hit.artistId, name: hit.name });
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (query.trim().length > 0) commitSearch(query);
  };

  const showSuggestions = isInputFocused && !hasCommitted && query.trim().length > 0 && suggestions.length > 0;
  const showBrowseState = query.trim().length === 0;

  return (
    <div className={styles.view}>
      <h1 className={styles.pageTitle}>Cari</h1>
      <div className={styles.searchAnchor}>
        <form className={styles.searchBox} onSubmit={handleSubmit}>
          <Icon name="search" size={18} />
          <input
            className={styles.input}
            type="text"
            inputMode="search"
            placeholder="Cari lagu, artis, atau album"
            value={query}
            onChange={(event) => handleInputChange(event.target.value)}
            onFocus={() => setIsInputFocused(true)}
            onBlur={() => setTimeout(() => setIsInputFocused(false), 150)}
          />
        </form>

        {showSuggestions && (
          <ul className={styles.suggestions}>
            {suggestions.map((suggestion) => (
              <li key={suggestion}>
                <button type="button" className={styles.suggestionRow} onClick={() => commitSearch(suggestion)}>
                  <Icon name="search" size={15} />
                  {suggestion}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {isLoading && (
        <div className={styles.list}>
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={`search-skeleton-${index}`} height="56px" borderRadius="14px" />
          ))}
        </div>
      )}

      {!isLoading && error && <p className={styles.state}>{error}</p>}

      {!isLoading && !error && showBrowseState && (
        <div className={styles.browseState}>
          {recentSearches.items.length > 0 && (
            <div className={styles.recentSection}>
              <div className={styles.recentHeader}>
                <span className={styles.sectionLabel}>Pencarian Terakhir</span>
                <button type="button" className={styles.clearButton} onClick={recentSearches.clear}>
                  Hapus semua
                </button>
              </div>
              <ul className={styles.recentList}>
                {recentSearches.items.map((term) => (
                  <li key={term} className={styles.recentItem}>
                    <button type="button" className={styles.recentButton} onClick={() => commitSearch(term)}>
                      <Icon name="clock" size={15} />
                      {term}
                    </button>
                    <button
                      type="button"
                      className={styles.recentRemove}
                      onClick={() => recentSearches.remove(term)}
                      aria-label={`Hapus "${term}" dari riwayat`}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className={styles.recentSection}>
            <span className={styles.sectionLabel}>Jelajahi</span>
            <BrowseCategoriesGrid onSelect={handleCategorySelect} />
          </div>
        </div>
      )}

      {!isLoading && !error && !showBrowseState && artist && (
        <button type="button" className={styles.artistCard} onClick={() => handleOpenArtist(artist)}>
          <LazyImage images={artist.image} quality="150x150" alt="" className={styles.artistPhoto} />
          <span className={styles.artistText}>
            <span className={styles.artistName}>{artist.name}</span>
            <span className={styles.artistHint}>Artis · Lihat profil</span>
          </span>
          <span className={styles.artistChevron} aria-hidden="true">
            <Icon name="chevron-left" size={18} />
          </span>
        </button>
      )}

      {!isLoading && !error && !showBrowseState && results.length === 0 && (
        <p className={styles.state}>Tidak ada hasil untuk &ldquo;{query}&rdquo;.</p>
      )}

      {!isLoading && !error && !showBrowseState && results.length > 0 && (
        <SearchResultsList songs={results} isCommitted={hasCommitted} />
      )}
    </div>
  );
}
