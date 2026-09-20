import { useEffect, useState } from 'react';
import { listLinkedDevices, unlinkDevice, type LinkedDevice } from '../../api/authClient';
import { useToast } from '../../components/Toast/ToastProvider';
import { useUiStore } from '../../stores/uiStore';
import { SettingsRow } from './SettingsRow';
import styles from './SettingsView.module.css';

const KIND_LABEL: Record<LinkedDevice['kind'], string> = { phone: 'Ponsel', tablet: 'Tablet', desktop: 'Komputer' };

function seenLabel(device: LinkedDevice): string {
  if (device.isThis) return `${KIND_LABEL[device.kind]} · perangkat ini`;
  const minutes = Math.round((Date.now() - new Date(device.lastSeenAt).getTime()) / 60000);
  if (minutes < 2) return `${KIND_LABEL[device.kind]} · aktif sekarang`;
  if (minutes < 60) return `${KIND_LABEL[device.kind]} · ${minutes} menit lalu`;
  if (minutes < 60 * 24) return `${KIND_LABEL[device.kind]} · ${Math.round(minutes / 60)} jam lalu`;
  return `${KIND_LABEL[device.kind]} · ${Math.round(minutes / 60 / 24)} hari lalu`;
}

/** Settings -> Perangkat: the devices sharing this library, and how to add one. */
export function LinkedDevices() {
  const { showToast } = useToast();
  const openLinkShow = useUiStore((state) => state.openLinkShow);
  const openLinkScan = useUiStore((state) => state.openLinkScan);
  const tick = useUiStore((state) => state.linkedDevicesTick);
  const bump = useUiStore((state) => state.bumpLinkedDevices);
  const [devices, setDevices] = useState<LinkedDevice[]>([]);

  useEffect(() => {
    let cancelled = false;
    listLinkedDevices()
      .then((list) => {
        if (!cancelled) setDevices(list);
      })
      .catch(() => {
        // offline: keep whatever was shown
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const handleUnlink = async (device: LinkedDevice) => {
    try {
      await unlinkDevice(device.ref);
      showToast(`${device.name} dilepas.`);
      bump();
    } catch {
      showToast('Gagal melepas perangkat.', { type: 'error' });
    }
  };

  return (
    <div className={styles.section}>
      <span className={styles.sectionTitle}>Perangkat</span>
      <div className={styles.card}>
        {devices.length > 1 &&
          devices.map((device) => (
            <SettingsRow
              key={device.ref}
              icon="pulse"
              title={device.name}
              subtitle={seenLabel(device)}
              control={
                device.isThis ? undefined : (
                  <button type="button" className={styles.linkButton} onClick={() => void handleUnlink(device)}>
                    Lepas
                  </button>
                )
              }
            />
          ))}
        <SettingsRow
          icon="database"
          title="Tautkan perangkat baru"
          subtitle="Tampilkan QR di sini (laptop / perangkat baru), lalu pindai dari HP."
          onClick={openLinkShow}
          control={<span className={styles.linkButton}>Tampilkan QR</span>}
        />
        <SettingsRow
          icon="search"
          title="Pindai QR dari perangkat lain"
          subtitle="Di HP yang sudah berisi lagu & playlist kamu."
          onClick={() => openLinkScan()}
          control={<span className={styles.linkButton}>Pindai</span>}
        />
      </div>
    </div>
  );
}
