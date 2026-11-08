import { Icon } from '../components/Icon/Icon';
import { useIsDesktop } from '../hooks/useIsDesktop';
import { useT } from '../i18n/i18n';
import styles from './DesktopUpdatePill.module.css';
import { useUpdateStore } from './updateStore';

/**
 * Desktop: the update notice closed down to its small island waits here, at the top right of the page panel (left of
 * where the fullscreen button sits), on every menu. Not in the notifications' own corner: that is the right panel's
 * top bar, and a pill staying there sat on its queue button for as long as the update waited. A tap opens the card.
 */
export function DesktopUpdatePill({ rightPanel }: { rightPanel: boolean }) {
  const t = useT();
  const isDesktop = useIsDesktop();
  const waiting = useUpdateStore((state) => state.status === 'available' && !state.noticeOpen && !state.noticeHidden);
  const open = useUpdateStore((state) => state.setNoticeOpen);
  if (!isDesktop || !waiting) return null;
  return (
    <button type="button" className={[styles.pill, rightPanel ? styles.withPanel : ''].join(' ')} onClick={() => open(true)} aria-label={t('Update tersedia')}>
      <Icon name="refresh" size={14} />
      {t('Update')}
    </button>
  );
}
