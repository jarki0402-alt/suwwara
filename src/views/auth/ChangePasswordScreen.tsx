import { useState, type FormEvent } from 'react';
import { changePassword, signOut, useAuthStore } from '../../auth/authStore';
import styles from './AuthScreens.module.css';

/** Shown right after signing in with an admin-issued temporary password: nothing else in the app opens until it is replaced. */
export function ChangePasswordScreen() {
  const minLength = useAuthStore((state) => (state.user?.role === 'admin' ? 12 : 8));
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (next.length < minLength) return setError(`Kata sandi baru minimal ${minLength} karakter.`);
    if (next !== again) return setError('Kata sandi baru dan konfirmasinya belum sama.');
    if (next === current) return setError('Kata sandi baru harus berbeda dari yang sementara.');
    setBusy(true);
    setError(null);
    const result = await changePassword(current, next);
    if (!result.ok) setError(result.message);
    setBusy(false);
  };

  return (
    <div className={styles.page}>
      <div className={styles.layout} style={{ maxWidth: 460 }}>
        <form className={styles.card} onSubmit={(event) => void handleSubmit(event)}>
          <h2 className={styles.cardTitle}>Buat kata sandi baru</h2>
          <p className={styles.cardSub}>Kata sandi tadi hanya sementara. Ganti dengan yang hanya kamu yang tahu.</p>
          <label className={styles.field}>
            <span className={styles.label}>Kata sandi sementara</span>
            <input className={styles.input} type="password" value={current} onChange={(event) => setCurrent(event.target.value)} autoComplete="current-password" required />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Kata sandi baru</span>
            <input className={styles.input} type="password" value={next} onChange={(event) => setNext(event.target.value)} autoComplete="new-password" minLength={minLength} required />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Ulangi kata sandi baru</span>
            <input className={styles.input} type="password" value={again} onChange={(event) => setAgain(event.target.value)} autoComplete="new-password" required />
          </label>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <button type="submit" className={styles.submit} disabled={busy || !current || !next || !again}>
            {busy ? 'Menyimpan…' : 'Simpan dan lanjut'}
          </button>
          <button type="button" className={styles.textButton} onClick={() => void signOut()}>
            Keluar
          </button>
        </form>
      </div>
    </div>
  );
}
