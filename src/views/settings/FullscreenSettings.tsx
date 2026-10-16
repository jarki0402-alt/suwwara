import { Switch } from '../../components/Switch/Switch';
import { useSettingsStore } from '../../stores/settingsStore';
import { enterFullscreen, isFullscreenSupported, toggleAppFullscreen, useIsDocumentFullscreen } from '../../utils/documentFullscreen';
import { SettingsRow } from './SettingsRow';
import styles from './SettingsView.module.css';

/** Pengaturan → Tampilan. Not shown where a page can't go fullscreen at all (iPhone). */
export function FullscreenSettings() {
  const isFullscreen = useIsDocumentFullscreen();
  const openInFullscreen = useSettingsStore((state) => state.openInFullscreen);
  const setOpenInFullscreen = useSettingsStore((state) => state.setOpenInFullscreen);
  if (!isFullscreenSupported) return null;

  return (
    <div className={styles.card}>
      <SettingsRow
        icon={isFullscreen ? 'fullscreen-exit' : 'fullscreen'}
        title="Layar penuh"
        subtitle="Tanpa bar browser dan jendela, seperti aplikasi. Tekan F atau Esc untuk keluar."
        onClick={toggleAppFullscreen}
        control={<span className={styles.linkButton}>{isFullscreen ? 'Keluar' : 'Masuk'}</span>}
      />
      <SettingsRow
        icon="expand"
        title="Buka dalam layar penuh"
        subtitle="Browser tidak mengizinkan layar penuh otomatis, jadi klik pertama setelah membuka Suwwara yang memulainya."
        control={
          <Switch
            checked={openInFullscreen}
            onChange={(value) => {
              setOpenInFullscreen(value);
              // Switching it on is itself a click: go fullscreen now instead of waiting for the next open.
              if (value) enterFullscreen('app');
            }}
            ariaLabel="Buka dalam layar penuh"
          />
        }
      />
    </div>
  );
}
