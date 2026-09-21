import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from '../Icon/Icon';
import styles from './OptionsMenu.module.css';

export interface OptionsMenuItem {
  key: string;
  icon: IconName;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Draws a divider above this item — groups the list (queue actions / library / navigation). */
  separatorBefore?: boolean;
}

interface OptionsMenuProps {
  /** Falsy entries are skipped, so callers can write `condition && item` inline. */
  items: Array<OptionsMenuItem | false | null | undefined>;
  ariaLabel?: string;
  /** Shown above the items in the phone's bottom sheet only (a song's cover and name) — a popover has no room for it. */
  header?: ReactNode;
  /** Replaces the default round ghost button's look, for a trigger that sits among other styled buttons. */
  triggerClassName?: string;
}

const PHONE_QUERY = '(max-width: 959px)';
const EDGE_GAP = 8;

/**
 * The "⋯" menu. On desktop it is a popover next to the button; on a phone, a sheet from the bottom.
 *
 * Rendered through a portal into <body>, and positioned from the button's own rectangle: the old version was an
 * absolutely positioned child of the row, so it was clipped by any scrolling ancestor, overlapped the rows below
 * it, and ran off the bottom of the window on the last rows. Here it flips above the button when there is no room
 * below, stays inside the window horizontally, and closes on scroll/resize (a fixed popover would otherwise stay
 * behind while the page moves under it).
 */
export function OptionsMenu({ items, ariaLabel = 'Opsi lainnya', header, triggerClassName }: OptionsMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const visibleItems = items.filter((item): item is OptionsMenuItem => Boolean(item));

  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!open || !trigger || !menu || window.matchMedia(PHONE_QUERY).matches) return;

    const anchor = trigger.getBoundingClientRect();
    const size = menu.getBoundingClientRect();
    let top = anchor.bottom + 4;
    if (top + size.height > window.innerHeight - EDGE_GAP) top = Math.max(EDGE_GAP, anchor.top - size.height - 4);
    const left = Math.min(Math.max(EDGE_GAP, anchor.right - size.width), window.innerWidth - size.width - EDGE_GAP);
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
    menu.style.visibility = 'visible';
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', close);
    // Capture: scrolling happens in an inner container, not on window, and scroll events don't bubble.
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName ?? styles.trigger}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Icon name="more" size={18} />
      </button>
      {open &&
        createPortal(
          <div
            className={styles.layer}
            // Marks a floating layer for anything that closes on "click outside" (the top bar's search dropdown must
            // stay open while a song's menu or dialog, which live in <body>, is being used).
            data-overlay=""
            // Clicks inside a portal still bubble to the React parent (a song row): keep them from playing the song.
            onClick={(event) => event.stopPropagation()}
          >
            <button type="button" className={styles.backdrop} onClick={() => setOpen(false)} aria-label="Tutup menu" />
            <div ref={menuRef} className={styles.menu} role="menu" style={{ top: 0, left: 0, visibility: window.matchMedia(PHONE_QUERY).matches ? 'visible' : 'hidden' }}>
              {header && <div className={styles.header}>{header}</div>}
              {visibleItems.map((item) => (
                <div key={item.key} className={styles.itemWrap}>
                  {item.separatorBefore && <div className={styles.separator} role="separator" />}
                  <button
                    type="button"
                    role="menuitem"
                    className={[styles.menuItem, item.danger ? styles.menuItemDanger : ''].join(' ')}
                    onClick={() => {
                      setOpen(false);
                      item.onClick();
                    }}
                    disabled={item.disabled}
                  >
                    <Icon name={item.icon} size={18} />
                    {item.label}
                  </button>
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
