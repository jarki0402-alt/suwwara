import { useState, type FormEvent } from 'react';
import { useAuthStore } from '../../auth/authStore';
import { ConfirmDialog } from '../../components/ConfirmDialog/ConfirmDialog';
import { Icon } from '../../components/Icon/Icon';
import { useToast } from '../../components/Toast/ToastProvider';
import { formatBytes } from '../../utils/formatBytes';
import { timeAgo } from '../../utils/deviceLabel';
import { adminApi, type AdminUser } from './adminApi';
import styles from './AdminView.module.css';
import { useAdminData } from './useAdminData';

interface Secret {
  username: string;
  password: string;
  kind: 'baru' | 'reset';
}

/** Create users, hand out temporary passwords, switch accounts off, sign devices out, delete. The admin makes every account. */
export function UsersPanel() {
  const me = useAuthStore((state) => state.user?.username);
  const { showToast } = useToast();
  const { data: users, error: loadError, reload } = useAdminData(adminApi.users);
  const { data: legacy, reload: reloadLegacy } = useAdminData(adminApi.legacyAccounts);
  const [legacyId, setLegacyId] = useState('');
  const [name, setName] = useState('');
  const [makeAdmin, setMakeAdmin] = useState(false);
  const [secret, setSecret] = useState<Secret | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<AdminUser | null>(null);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      reload();
      reloadLegacy();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Gagal.');
    } finally {
      setBusy(false);
    }
  };

  const create = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const created = await adminApi.createUser(name.trim().toLowerCase(), makeAdmin ? 'admin' : 'user', makeAdmin || !legacyId ? undefined : legacyId);
      setSecret({ username: created.username, password: created.temporaryPassword, kind: 'baru' });
      setName('');
      setMakeAdmin(false);
      setLegacyId('');
    });
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast('Disalin.');
    } catch {
      showToast('Gagal menyalin — salin manual.', { type: 'error' });
    }
  };

  return (
    <>
      <div className={styles.card}>
        <h2 className={styles.cardTitle}>Tambah pengguna</h2>
        <form className={styles.form} onSubmit={create}>
          <input className={styles.input} placeholder="nama.pengguna" value={name} onChange={(event) => setName(event.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={32} />
          <button type="button" className={`${styles.btn} ${makeAdmin ? styles.btnPrimary : ''}`} onClick={() => setMakeAdmin((value) => !value)} aria-pressed={makeAdmin}>
            Admin
          </button>
          <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy || name.trim().length < 3}>
            Buat
          </button>
        </form>
        {!makeAdmin && (legacy ?? []).length > 0 && (
          <div className={styles.selectField}>
            <span className={styles.selectLabel}>Pakai pustaka dari akun lama (opsional)</span>
            <span className={styles.muted}>Playlist dan lagu disukai dari sebelum login — tak diklaim akun mana pun.</span>
            <div className={styles.selectWrap}>
              <select className={styles.select} value={legacyId} onChange={(event) => setLegacyId(event.target.value)}>
                <option value="">Akun baru yang kosong</option>
                {(legacy ?? []).map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.liked} lagu disukai · {account.playlists} playlist{account.playlistNames.length ? ` (${account.playlistNames.join(', ')})` : ''}
                    {account.lastSeen ? ` · aktif ${timeAgo(account.lastSeen)}` : ''}
                  </option>
                ))}
              </select>
              <Icon name="chevron-down" size={16} className={styles.selectChevron} />
            </div>
          </div>
        )}
        <p className={styles.muted}>Sandi sementara dibuat otomatis dan hanya tampil sekali; pengguna wajib menggantinya saat pertama masuk. Admin: 12+ karakter dan tidak memutar musik.</p>
        {secret && (
          <div className={styles.secret}>
            <span className={styles.muted}>
              {secret.kind === 'baru' ? 'Akun dibuat' : 'Sandi direset'} — <strong>{secret.username}</strong>
            </span>
            <span className={styles.secretValue}>{secret.password}</span>
            <button type="button" className={styles.btn} onClick={() => void copy(secret.password)}>
              Salin
            </button>
            <button type="button" className={styles.btn} onClick={() => setSecret(null)}>
              Tutup
            </button>
          </div>
        )}
        {(error || loadError) && <p className={styles.error}>{error ?? loadError}</p>}
      </div>

      <div className={styles.userList}>
        {(users ?? []).map((user) => {
          const self = user.username === me;
          return (
            <div key={user.id} className={styles.user}>
              <div className={styles.userTop}>
                <span className={styles.userName}>{user.username}</span>
                {user.role === 'admin' && <span className={styles.badge}>Admin</span>}
                {user.disabled && <span className={`${styles.badge} ${styles.badgeOff}`}>Nonaktif</span>}
                {user.must_change_password && <span className={`${styles.badge} ${styles.badgeWarn}`}>Sandi sementara</span>}
                {self && <span className={styles.badge}>Kamu</span>}
              </div>
              <span className={styles.muted}>
                {user.sessions} sesi · {user.devices} perangkat · {user.last_login_at ? `masuk ${timeAgo(user.last_login_at)}` : 'belum pernah masuk'} · hari ini {formatBytes(user.today_bytes)} · 30 hari {formatBytes(user.month_bytes)}
              </span>
              <div className={styles.actions}>
                <button type="button" className={styles.btn} disabled={busy} onClick={() => void run(async () => setSecret({ username: user.username, password: (await adminApi.resetPassword(user.id)).temporaryPassword, kind: 'reset' }))}>
                  Reset sandi
                </button>
                <button type="button" className={styles.btn} disabled={busy || user.sessions === 0} onClick={() => void run(() => adminApi.signOutAll(user.id))}>
                  Keluarkan semua perangkat
                </button>
                {!self && (
                  <>
                    <button type="button" className={styles.btn} disabled={busy} onClick={() => void run(() => adminApi.update(user.id, { disabled: !user.disabled }))}>
                      {user.disabled ? 'Aktifkan' : 'Nonaktifkan'}
                    </button>
                    <button type="button" className={styles.btn} disabled={busy} onClick={() => void run(() => adminApi.update(user.id, { role: user.role === 'admin' ? 'user' : 'admin' }))}>
                      {user.role === 'admin' ? 'Jadikan pengguna biasa' : 'Jadikan admin'}
                    </button>
                    <button type="button" className={`${styles.btn} ${styles.btnDanger}`} disabled={busy} onClick={() => setDeleting(user)}>
                      Hapus
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        isOpen={deleting !== null}
        title={`Hapus ${deleting?.username ?? 'pengguna'}?`}
        description="Akunnya beserta playlist, lagu disukai, dan riwayatnya dihapus permanen. Tindakan ini tidak bisa dibatalkan."
        confirmLabel="Hapus"
        onConfirm={() => {
          const target = deleting;
          setDeleting(null);
          if (target) void run(() => adminApi.remove(target.id));
        }}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}
