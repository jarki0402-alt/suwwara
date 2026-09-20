import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '../../components/Icon/Icon';
import styles from './Shelf.module.css';

interface ShelfProps {
  title: string;
  hint?: string;
  /** Shown instead of the row when there is nothing to put in it (yet). */
  emptyText?: string;
  className?: string;
  children?: ReactNode;
}

/**
 * A titled row that scrolls sideways, on desktop and phone alike, so a long list never turns Home
 * into a wall of covers. Touch and trackpads just swipe; a plain mouse wheel can't scroll sideways,
 * so on desktop the heading also carries two arrows (hidden while everything already fits).
 */
export function Shelf({ title, hint, emptyText, className, children }: ShelfProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canScroll, setCanScroll] = useState({ back: false, forward: false });

  const measure = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const back = el.scrollLeft > 4;
    const forward = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setCanScroll((current) => (current.back === back && current.forward === forward ? current : { back, forward }));
  }, []);

  // Re-measured after every render: the row's content arrives later (recommendations load), and the
  // scroller's own box doesn't change size when that happens, so a ResizeObserver on it would miss it.
  useEffect(measure);

  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  const scrollByPage = (direction: 1 | -1) => {
    const el = scrollerRef.current;
    if (el) el.scrollBy({ left: direction * el.clientWidth * 0.85, behavior: 'smooth' });
  };

  return (
    <section className={[styles.section, className].filter(Boolean).join(' ')}>
      <div className={styles.headingRow}>
        <div className={styles.headingText}>
          <h2 className={styles.heading}>{title}</h2>
          {hint && <p className={styles.hint}>{hint}</p>}
        </div>
        {(canScroll.back || canScroll.forward) && (
          <div className={styles.arrows}>
            <button type="button" className={styles.arrow} onClick={() => scrollByPage(-1)} disabled={!canScroll.back} aria-label="Geser ke kiri">
              <Icon name="chevron-left" size={16} />
            </button>
            <button
              type="button"
              className={[styles.arrow, styles.arrowForward].join(' ')}
              onClick={() => scrollByPage(1)}
              disabled={!canScroll.forward}
              aria-label="Geser ke kanan"
            >
              <Icon name="chevron-left" size={16} />
            </button>
          </div>
        )}
      </div>
      {emptyText ? (
        <p className={styles.empty}>{emptyText}</p>
      ) : (
        <div ref={scrollerRef} className={styles.scroller} onScroll={measure}>
          {children}
        </div>
      )}
    </section>
  );
}
