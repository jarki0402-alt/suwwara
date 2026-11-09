import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import styles from './MarqueeText.module.css';

// Slow on purpose (asked for): a title is read while it moves, not chased.
const PX_PER_SEC = 28;
// Still at each end for a moment, so the start and the end can both be read.
const PAUSE_SEC = 2.5;

/**
 * A title that slides left (and back) when it doesn't fit its box, and stays still when it does. Only the CSS
 * transform animates (the compositor's job, no re-render, no JS per frame); the width is measured on mount and when
 * the box or the text changes size. Off with prefers-reduced-motion, where it is clipped with an ellipsis like
 * before.
 */
export function MarqueeText({ text }: { text: string }) {
  const boxRef = useRef<HTMLSpanElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(0);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const inner = innerRef.current;
    if (!box || !inner) return;
    const measure = () => setOverflow(Math.max(0, Math.ceil(inner.scrollWidth - box.clientWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [text]);

  const moving = overflow > 2;
  const travel = overflow / PX_PER_SEC;
  const style = moving
    ? ({
        '--marquee-distance': `-${overflow}px`,
        // One way = the pause plus the travel; the keyframes spend the first and last part of it standing still.
        '--marquee-duration': `${(travel + PAUSE_SEC) * 2}s`,
      } as CSSProperties)
    : undefined;

  return (
    <span ref={boxRef} className={[styles.box, moving ? styles.moving : ''].join(' ')} title={moving ? text : undefined}>
      <span ref={innerRef} key={text} className={styles.inner} style={style}>
        {text}
      </span>
    </span>
  );
}
