import { useCallback, useEffect, useState } from 'react';
import { listSessions, revokeSessionById, type SessionRow } from '../../auth/authApi';
import { signOut, useAuthStore } from '../../auth/authStore';
import { deviceLabel, timeAgo } from '../../utils/deviceLabel';
import { PasswordForm } from './PasswordForm';
import { SettingsRow } from './SettingsRow';
import settingsStyles from './SettingsView.module.css';

/** Who is signed in, the devices signed in to the account, change password, sign out — and the way into the admin dashboard. */
export function AccountSection() {
  const user = useAuthStore((state) => state.user);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [changing, setChanging] = useState(false);

  const refresh = useCallback(async () => setSessions(await listSessions()), []);
  useEffect(() => {
    void listSessions().then(setSessions);
  }, []);

  if (!user) return null;

  return (
    <div className={settingsStyles.section}>
      <span className={settingsStyles.sectionTitle}>Akun</span>
      <div className={settingsStyles.card}>
        <SettingsRow icon="artist" title={user.username} subtitle={'Masuk di semua perangkatmu sekaligus'} />
        {changing ? (
          <PasswordForm minLength={8} onDone={() => setChanging(false)} />
        ) : (
          <SettingsRow icon="edit" title="Ganti kata sandi" onClick={() => setChanging(true)} />
        )}
        {sessions.length > 0 && (
          <div className={settingsStyles.storageCaption}>Perangkat yang sedang masuk</div>
        )}
        {sessions.map((session) => (
          <SettingsRow
            key={session.id}
            icon="devices"
            title={deviceLabel(session.userAgent)}
            subtitle={session.current ? 'Perangkat ini' : `Aktif ${timeAgo(session.lastSeenAt)}`}
            onClick={session.current ? undefined : () => void revokeSessionById(session.id).then(refresh)}
            control={session.current ? undefined : <span className={settingsStyles.linkButton}>Keluarkan</span>}
          />
        ))}
        <SettingsRow icon="close" title="Keluar" subtitle="Menghapus data akun ini dari perangkat ini." onClick={() => void signOut()} />
      </div>
    </div>
  );
}
