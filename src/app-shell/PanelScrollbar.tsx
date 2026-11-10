import { useEffect, useRef, type RefObject } from 'react';
import styles from './PanelScrollbar.module.css';

// Same rhythm as the app's other scrollbars (utils/autoHideScrollbars.ts): shown while scrolling, gone shortly after.
const VISIBLE_AFTER_SCROLL_MS = 900;
// The native track started a rounded corner's height in (global.css margin-block: 18px); so does this one.
const TRACK_INSET_PX = 18;
const MIN_THUMB_PX = 32;

/**
 * The page panel's scrollbar on desktop, drawn over the page instead of beside it, like macOS overlay scrollbars.
 *
 * Why: styling ::-webkit-scrollbar (global.css) makes Chrome reserve a 12px gutter for it on every Mac, overlay
 * setting or not, and nothing the page draws can reach under that gutter. On a page coloured or bannered to the
 * edge (an artist, an album, a playlist) it showed as an empty band down the right side. So the panel's own
 * scrollbar is hidden (AppShell.module.css) and this one floats over the page's right edge: the page runs the full
 * width. Same look and timing as before (a 6px grey thumb, only while scrolling or hovered), still draggable, and
 * the track can be clicked to page up/down. Wheel, trackpad and keys scroll the panel natively as always.
 *
 * Cheap: no React state at all. Geometry is read when a scroll happens (one rAF per frame while scrolling), the thumb
 * moves by transform, and nothing runs while the page is still.
 */
export function PanelScrollbar({ panelRef }: { panelRef: RefObject<HTMLElement | null> }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const panel = panelRef.current;
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!panel || !track || !thumb) return;
    let frame = 0;
    let hideTimer: ReturnType<typeof setTimeout> | undefined;
    let geometry = { thumbHeight: 0, travel: 0, scrollable: 0 };

    const layout = () => {
      frame = 0;
      const box = panel.getBoundingClientRect();
      const scrollable = panel.scrollHeight - panel.clientHeight;
      if (scrollable <= 1) {
        track.dataset.hidden = 'true';
        return;
      }
      delete track.dataset.hidden;
      const trackHeight = panel.clientHeight - 2 * TRACK_INSET_PX;
      const thumbHeight = Math.max(MIN_THUMB_PX, (panel.clientHeight / panel.scrollHeight) * trackHeight);
      geometry = { thumbHeight, travel: trackHeight - thumbHeight, scrollable };
      track.style.top = `${box.top + panel.clientTop + TRACK_INSET_PX}px`;
      track.style.left = `${box.left + panel.clientLeft + panel.clientWidth - track.offsetWidth}px`;
      track.style.height = `${trackHeight}px`;
      thumb.style.height = `${thumbHeight}px`;
      thumb.style.transform = `translateY(${(panel.scrollTop / scrollable) * geometry.travel}px)`;
    };
    const show = () => {
      track.dataset.active = 'true';
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(() => {
        if (track.dataset.dragging !== 'true') delete track.dataset.active;
      }, VISIBLE_AFTER_SCROLL_MS);
    };
    const onScroll = () => {
      show();
      if (!frame) frame = requestAnimationFrame(layout);
    };
    // Hovering the strip shows the bar (so it can be grabbed), as with the native one.
    const onEnter = () => {
      layout();
      track.dataset.active = 'true';
      if (hideTimer) clearTimeout(hideTimer);
    };
    const onLeave = () => {
      if (track.dataset.dragging !== 'true') show();
    };

    let dragStartY = 0;
    let dragStartScroll = 0;
    const onThumbDown = (event: PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      layout();
      thumb.setPointerCapture(event.pointerId);
      track.dataset.dragging = 'true';
      dragStartY = event.clientY;
      dragStartScroll = panel.scrollTop;
    };
    const onThumbMove = (event: PointerEvent) => {
      if (track.dataset.dragging !== 'true' || geometry.travel <= 0) return;
      panel.scrollTop = dragStartScroll + ((event.clientY - dragStartY) / geometry.travel) * geometry.scrollable;
    };
    const onThumbUp = (event: PointerEvent) => {
      if (thumb.hasPointerCapture(event.pointerId)) thumb.releasePointerCapture(event.pointerId);
      delete track.dataset.dragging;
      show();
    };
    // A click on the track beside the thumb pages towards it, like the native bar.
    const onTrackDown = (event: PointerEvent) => {
      if (event.target !== track) return;
      const thumbBox = thumb.getBoundingClientRect();
      const direction = event.clientY < thumbBox.top ? -1 : 1;
      panel.scrollBy({ top: direction * panel.clientHeight * 0.9, behavior: 'smooth' });
    };

    panel.addEventListener('scroll', onScroll, { passive: true });
    track.addEventListener('pointerenter', onEnter);
    track.addEventListener('pointerleave', onLeave);
    track.addEventListener('pointerdown', onTrackDown);
    thumb.addEventListener('pointerdown', onThumbDown);
    thumb.addEventListener('pointermove', onThumbMove);
    thumb.addEventListener('pointerup', onThumbUp);
    thumb.addEventListener('pointercancel', onThumbUp);
    // The panel moves and resizes with the window and the side panels: place the strip again then.
    const observer = new ResizeObserver(() => {
      if (!frame) frame = requestAnimationFrame(layout);
    });
    observer.observe(panel);
    layout();
    return () => {
      panel.removeEventListener('scroll', onScroll);
      track.removeEventListener('pointerenter', onEnter);
      track.removeEventListener('pointerleave', onLeave);
      track.removeEventListener('pointerdown', onTrackDown);
      thumb.removeEventListener('pointerdown', onThumbDown);
      thumb.removeEventListener('pointermove', onThumbMove);
      thumb.removeEventListener('pointerup', onThumbUp);
      thumb.removeEventListener('pointercancel', onThumbUp);
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, [panelRef]);

  return (
    <div ref={trackRef} className={styles.track} aria-hidden="true">
      <div ref={thumbRef} className={styles.thumb} />
    </div>
  );
}
