import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { listSessions, revokeSessionById, type SessionRow } from '../../auth/authApi';
import { changePassword, signOut, useAuthStore } from '../../auth/authStore';
import { useToast } from '../../components/Toast/ToastProvider';
import { useUiStore } from '../../stores/uiStore';
import { deviceLabel, timeAgo } from '../../utils/deviceLabel';
import styles from './AccountSection.module.css';
import { SettingsRow } from './SettingsRow';
import settingsStyles from './SettingsView.module.css';

function PasswordForm({ onDone }: { onDone: () => void }) {
  const { showToast } = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (next.length < 8) return setError('Kata sandi baru minimal 8 karakter.');
    setBusy(true);
    setError(null);
    const result = await changePassword(current, next);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    showToast('Kata sandi diganti. Perangkat lain perlu masuk lagi.');
    onDone();
  };

  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)}>
      <input className={styles.input} type="password" placeholder="Kata sandi saat ini" value={current} onChange={(event) => setCurrent(event.target.value)} autoComplete="current-password" required />
      <input className={styles.input} type="password" placeholder="Kata sandi baru (min. 8 karakter)" value={next} onChange={(event) => setNext(event.target.value)} autoComplete="new-password" required />
      {error && <p className={`${styles.message} ${styles.error}`}>{error}</p>}
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={busy || !current || !next}>
          {busy ? 'Menyimpan…' : 'Simpan'}
        </button>
        <button type="button" className={styles.secondary} onClick={onDone}>
          Batal
        </button>
      </div>
    </form>
  );
}

/** Who is signed in, the devices signed in to the account, change password, sign out — and the way into the admin dashboard. */
export function AccountSection() {
  const user = useAuthStore((state) => state.user);
  const setView = useUiStore((state) => state.setView);
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
        <SettingsRow icon="artist" title={user.username} subtitle={user.role === 'admin' ? 'Admin · masuk di semua perangkatmu sekaligus' : 'Masuk di semua perangkatmu sekaligus'} />
        {user.role === 'admin' && (
          <SettingsRow icon="pulse" title="Dashboard Admin" subtitle="Pengguna, pemakaian, dan kesehatan server." onClick={() => setView('admin')} control={<span className={settingsStyles.linkButton}>Buka</span>} />
        )}
        {changing ? (
          <PasswordForm onDone={() => setChanging(false)} />
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
