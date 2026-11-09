import { Icon } from '../Icon/Icon';
import { useT } from '../../i18n/i18n';
import styles from './SearchClearButton.module.css';

/**
 * The × at the end of every search box (Beranda, Cari, Podcast, a playlist's "add songs"): shown only while there is
 * text, clears it in one tap. mousedown is kept from the input so the box doesn't lose focus (its results/suggestions
 * close on blur), and focus is handed back so typing goes on at once.
 */
export function SearchClearButton({ onClear, inputId, className }: { onClear: () => void; inputId?: string; className?: string }) {
  const t = useT();
  return (
    <button
      type="button"
      className={[styles.button, className ?? ''].join(' ')}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        onClear();
        const input = inputId ? document.getElementById(inputId) : (event.currentTarget.parentElement?.querySelector('input') ?? null);
        (input as HTMLInputElement | null)?.focus();
      }}
      aria-label={t('Hapus pencarian')}
    >
      <Icon name="close" size={16} />
    </button>
  );
}
