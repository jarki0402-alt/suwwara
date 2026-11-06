import { Switch } from '../../components/Switch/Switch';
import { useT } from '../../i18n/i18n';
import { useSettingsStore } from '../../stores/settingsStore';
import { enterFullscreen, isFullscreenSupported, toggleAppFullscreen, useIsDocumentFullscreen } from '../../utils/documentFullscreen';
import { SettingsRow } from './SettingsRow';
import styles from './SettingsView.module.css';

/** Pengaturan → Tampilan. Not shown where a page can't go fullscreen at all (iPhone). */
export function FullscreenSettings() {
  const t = useT();
  const isFullscreen = useIsDocumentFullscreen();
  const openInFullscreen = useSettingsStore((state) => state.openInFullscreen);
  const setOpenInFullscreen = useSettingsStore((state) => state.setOpenInFullscreen);
  if (!isFullscreenSupported) return null;

  return (
    <div className={styles.card}>
      <SettingsRow
        icon={isFullscreen ? 'fullscreen-exit' : 'fullscreen'}
        title={t('Layar penuh')}
        subtitle={t('Tanpa bar browser dan jendela, seperti aplikasi. Tekan F atau Esc untuk keluar.')}
        onClick={toggleAppFullscreen}
        // Nyalakan/Matikan, not Masuk/Keluar: those already mean sign in / leave elsewhere, and a text has one translation.
        control={<span className={styles.linkButton}>{isFullscreen ? t('Matikan') : t('Nyalakan')}</span>}
      />
      <SettingsRow
        icon="expand"
        title={t('Buka dalam layar penuh')}
        subtitle={t('Browser tidak mengizinkan layar penuh otomatis, jadi klik pertama setelah membuka Suwwara yang memulainya.')}
        control={
          <Switch
            checked={openInFullscreen}
            onChange={(value) => {
              setOpenInFullscreen(value);
              // Switching it on is itself a click: go fullscreen now instead of waiting for the next open.
              if (value) enterFullscreen('app');
            }}
            ariaLabel={t('Buka dalam layar penuh')}
          />
        }
      />
    </div>
  );
}
