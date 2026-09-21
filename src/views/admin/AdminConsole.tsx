import { useCallback, useEffect, useState } from 'react';
import { listSessions, revokeSessionById, type SessionRow } from '../../auth/authApi';
import { signOut, useAuthStore } from '../../auth/authStore';
import { Icon, type IconName } from '../../components/Icon/Icon';
import { PasswordForm } from '../settings/PasswordForm';
import { deviceLabel, timeAgo } from '../../utils/deviceLabel';
import { Overview, SecurityPanel, SystemPanel, UsagePanel } from './AdminPanels';
import styles from './AdminConsole.module.css';
import panelStyles from './AdminView.module.css';
import { UsersPanel } from './UsersPanel';

type Tab = 'ringkasan' | 'pengguna' | 'pemakaian' | 'sistem' | 'keamanan' | 'akun';
const TABS: Array<{ id: Tab; label: string; icon: IconName }> = [
  { id: 'ringkasan', label: 'Ringkasan', icon: 'home' },
  { id: 'pengguna', label: 'Pengguna', icon: 'users' },
  { id: 'pemakaian', label: 'Pemakaian', icon: 'pulse' },
  { id: 'sistem', label: 'Sistem', icon: 'database' },
  { id: 'keamanan', label: 'Keamanan', icon: 'queue' },
  { id: 'akun', label: 'Akun', icon: 'artist' },
];

/** The admin's own account: change password, see and end the sessions signed in to it, sign out. */
function AccountPanel() {
  const user = useAuthStore((state) => state.user);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [changing, setChanging] = useState(false);
  const refresh = useCallback(async () => setSessions(await listSessions()), []);
  useEffect(() => {
    void listSessions().then(setSessions);
  }, []);

  return (
    <>
      <div className={panelStyles.card}>
        <h2 className={panelStyles.cardTitle}>{user?.username}</h2>
        <p className={panelStyles.muted}>Akun admin: mengelola aplikasi, tidak memutar musik. Sesi admin berlaku 7 hari dan kata sandinya minimal 12 karakter.</p>
        {changing ? (
          <PasswordForm minLength={12} plain onDone={() => setChanging(false)} />
        ) : (
          <div className={panelStyles.actions}>
            <button type="button" className={panelStyles.btn} onClick={() => setChanging(true)}>
              Ganti kata sandi
            </button>
            <button type="button" className={`${panelStyles.btn} ${panelStyles.btnDanger}`} onClick={() => void signOut()}>
              Keluar
            </button>
          </div>
        )}
      </div>
      <div className={panelStyles.card}>
        <h2 className={panelStyles.cardTitle}>Perangkat yang sedang masuk</h2>
        {sessions.map((session) => (
          <div key={session.id} className={panelStyles.row}>
            <span>
              {deviceLabel(session.userAgent)}
              {session.current ? ' · perangkat ini' : ''}
            </span>
            <span className={panelStyles.rowValue}>
              {session.current ? '' : `${timeAgo(session.lastSeenAt)} `}
              {!session.current && (
                <button type="button" className={panelStyles.btn} onClick={() => void revokeSessionById(session.id).then(refresh)}>
                  Keluarkan
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * What an admin account sees instead of the music app: a management console with its own layout and NOTHING of the player —
 * no audio engine, no library or profile sync, no device connection. Same URL and sign-in as everyone; the role decides
 * (see App.tsx). Loaded lazily, so a listener never downloads any of it.
 */
export default function AdminConsole() {
  const user = useAuthStore((state) => state.user);
  const [tab, setTab] = useState<Tab>('ringkasan');
  const current = TABS.find((item) => item.id === tab) ?? TABS[0];

  const brand = (
    <span className={styles.brand}>
      <span className={styles.brandMark}>
        <Icon name="pulse" size={15} />
      </span>
      Suwwara <span className={styles.adminBadge}>Admin</span>
    </span>
  );

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar} aria-label="Menu admin">
        {brand}
        {TABS.map((item) => (
          <button key={item.id} type="button" className={[styles.navItem, tab === item.id ? styles.navActive : ''].join(' ')} onClick={() => setTab(item.id)} aria-current={tab === item.id ? 'page' : undefined}>
            <Icon name={item.icon} size={20} />
            {item.label}
          </button>
        ))}
        <div className={styles.sidebarFooter}>
          <strong>{user?.username}</strong>
          <span className={styles.muted}>Admin</span>
        </div>
      </aside>

      <header className={styles.topbar}>
        {brand}
        <button type="button" className={styles.iconButton} onClick={() => void signOut()}>
          Keluar
        </button>
      </header>
      <div className={styles.tabs} role="tablist">
        {TABS.map((item) => (
          <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={[styles.tab, tab === item.id ? styles.tabActive : ''].join(' ')} onClick={() => setTab(item.id)}>
            {item.label}
          </button>
        ))}
      </div>

      <main className={styles.content}>
        <div className={styles.page}>
          <h1 className={styles.pageTitle}>{current.label}</h1>
          {tab === 'ringkasan' && <Overview />}
          {tab === 'pengguna' && <UsersPanel />}
          {tab === 'pemakaian' && <UsagePanel />}
          {tab === 'sistem' && <SystemPanel />}
          {tab === 'keamanan' && <SecurityPanel />}
          {tab === 'akun' && <AccountPanel />}
        </div>
      </main>
    </div>
  );
}
