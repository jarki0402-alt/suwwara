import { Switch } from '../../components/Switch/Switch';
import { useT } from '../../i18n/i18n';
import { useSettingsStore } from '../../stores/settingsStore';
import { SettingsRow } from './SettingsRow';

export function DataSaverToggle() {
  const t = useT();
  const dataSaver = useSettingsStore((state) => state.dataSaver);
  const setDataSaver = useSettingsStore((state) => state.setDataSaver);

  return (
    <SettingsRow
      icon="wifi-off"
      title={t('Data Saver')}
      subtitle={t('Turunkan kualitas audio untuk menghemat kuota internet.')}
      control={<Switch checked={dataSaver} onChange={setDataSaver} ariaLabel={t('Data Saver')} />}
    />
  );
}
