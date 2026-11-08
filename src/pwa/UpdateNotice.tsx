import { useEffect } from 'react';
import { Icon } from '../components/Icon/Icon';
import styles from '../components/Toast/Toast.module.css';
import { useIsDesktop } from '../hooks/useIsDesktop';
import { useT } from '../i18n/i18n';
import { applyUpdate } from './registerSW';
import { useUpdateStore } from './updateStore';

// Opened this long, then it closes down to the small "Update" island (a live activity): still there, not in the way.
const OPEN_MS = 7000;

/**
 * "Update tersedia · Muat ulang", pinned above the notifications until it's dealt with. Drawn from the update store's
 * one status rather than shown as a toast on each "new version found" event: those can fire more than once (every
 * hourly or on-resume check that finds a newer build, a second tab), and each used to add its own toast, the doubled
 * notices. A status can only be shown once. It opens, then shrinks to a small island; a tap opens it again. The ×
 * hides it for this session; Pengaturan still offers the update.
 */
export function UpdateNotice() {
  const t = useT();
  const available = useUpdateStore((state) => state.status === 'available');
  const hidden = useUpdateStore((state) => state.noticeHidden);
  const open = useUpdateStore((state) => state.noticeOpen);
  const setOpen = useUpdateStore((state) => state.setNoticeOpen);
  const hide = useUpdateStore((state) => state.hideNotice);
  const isDesktop = useIsDesktop();

  useEffect(() => {
    if (!available || !open) return;
    const timer = setTimeout(() => setOpen(false), OPEN_MS);
    return () => clearTimeout(timer);
  }, [available, open, setOpen]);

  if (!available || hidden) return null;
  if (!open) {
    // Desktop: the small island lives in the top bar instead (DesktopUpdatePill), where it covers nothing; in the
    // top-right corner it sat on the right panel's queue button for as long as the update waited.
    if (isDesktop) return null;
    return (
      <button type="button" className={styles.compact} onClick={() => setOpen(true)} aria-label={t('Update tersedia')}>
        <Icon name="refresh" size={14} />
        {t('Update')}
      </button>
    );
  }
  return (
    <div className={styles.toast} role="status">
      <span className={styles.pinnedText}>
        <span className={styles.pinnedTitle}>{t('Update tersedia')}</span>
        <span className={styles.pinnedSub}>{t('Muat ulang untuk memakai versi terbaru.')}</span>
      </span>
      <span className={styles.pinnedButtons}>
        <button type="button" className={styles.action} onClick={() => applyUpdate()}>
          {t('Muat ulang')}
        </button>
        <button type="button" className={styles.close} onClick={hide} aria-label={t('Tutup')}>
          <Icon name="close" size={16} />
        </button>
      </span>
    </div>
  );
}
