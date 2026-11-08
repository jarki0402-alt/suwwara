import { useState } from 'react';
import { Icon } from '../components/Icon/Icon';
import styles from '../components/Toast/Toast.module.css';
import { useT } from '../i18n/i18n';
import { applyUpdate } from './registerSW';
import { useUpdateStore } from './updateStore';

/**
 * "Update tersedia · Muat ulang", pinned above the notifications until it's dealt with. Drawn from the update store's
 * one status rather than shown as a toast on each "new version found" event: those can fire more than once (every
 * hourly or on-resume check that finds a newer build, a second tab), and each used to add its own toast, the doubled
 * notices. A status can only be shown once. The × hides it for this session; Pengaturan still offers the update.
 */
export function UpdateNotice() {
  const t = useT();
  const available = useUpdateStore((state) => state.status === 'available');
  const [hidden, setHidden] = useState(false);
  if (!available || hidden) return null;
  return (
    <div className={[styles.toast, styles.pinned].join(' ')} role="status">
      <span className={styles.pinnedText}>
        <span className={styles.pinnedTitle}>{t('Update tersedia')}</span>
        <span className={styles.pinnedSub}>{t('Muat ulang untuk memakai versi terbaru.')}</span>
      </span>
      <span className={styles.pinnedButtons}>
        <button type="button" className={styles.action} onClick={() => applyUpdate()}>
          {t('Muat ulang')}
        </button>
        <button type="button" className={styles.close} onClick={() => setHidden(true)} aria-label={t('Tutup')}>
          <Icon name="close" size={16} />
        </button>
      </span>
    </div>
  );
}
