import { useState } from 'react';
import { Icon, type IconName } from '../Icon/Icon';
import styles from './OptionsMenu.module.css';

export interface OptionsMenuItem {
  key: string;
  icon: IconName;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

interface OptionsMenuProps {
  items: OptionsMenuItem[];
  ariaLabel?: string;
}

/** Reusable "⋯" dropdown — first built for the queue's per-row menu, extracted so
 * search results (and anywhere else) can offer the same actions consistently. */
export function OptionsMenu({ items, ariaLabel = 'Opsi lainnya' }: OptionsMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className={styles.anchor}>
      <button type="button" className={styles.trigger} onClick={() => setOpen((value) => !value)} aria-label={ariaLabel} aria-expanded={open}>
        <Icon name="more" size={16} />
      </button>
      {open && (
        <>
          <button type="button" className={styles.backdrop} onClick={() => setOpen(false)} aria-label="Tutup menu" />
          <div className={styles.menu}>
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                className={[styles.menuItem, item.danger ? styles.menuItemDanger : ''].join(' ')}
                onClick={() => {
                  item.onClick();
                  setOpen(false);
                }}
                disabled={item.disabled}
              >
                <Icon name={item.icon} size={16} />
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
