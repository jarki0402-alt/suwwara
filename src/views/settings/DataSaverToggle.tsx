import { Switch } from '../../components/Switch/Switch';
import { useSettingsStore } from '../../stores/settingsStore';
import { SettingsRow } from './SettingsRow';

export function DataSaverToggle() {
  const dataSaver = useSettingsStore((state) => state.dataSaver);
  const setDataSaver = useSettingsStore((state) => state.setDataSaver);

  return (
    <SettingsRow
      icon="wifi-off"
      title="Data Saver"
      subtitle="Turunkan kualitas audio untuk menghemat kuota internet."
      control={<Switch checked={dataSaver} onChange={setDataSaver} ariaLabel="Data Saver" />}
    />
  );
}
