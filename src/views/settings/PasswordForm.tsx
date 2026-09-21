import { useState, type FormEvent } from 'react';
import { changePassword } from '../../auth/authStore';
import { useToast } from '../../components/Toast/ToastProvider';
import styles from './PasswordForm.module.css';

/** Change the signed-in user's password. `minLength` is 8 for a listener and 12 for an admin (server/src/auth/policy.ts). */
export function PasswordForm({ minLength, onDone, plain = false }: { minLength: number; onDone: () => void; plain?: boolean }) {
  const { showToast } = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (next.length < minLength) return setError(`Kata sandi baru minimal ${minLength} karakter.`);
    setBusy(true);
    setError(null);
    const result = await changePassword(current, next);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    showToast('Kata sandi diganti. Perangkat lain perlu masuk lagi.');
    onDone();
  };

  return (
    <form className={[styles.form, plain ? styles.plain : ''].join(' ')} onSubmit={(event) => void submit(event)}>
      <input className={styles.input} type="password" placeholder="Kata sandi saat ini" value={current} onChange={(event) => setCurrent(event.target.value)} autoComplete="current-password" required />
      <input className={styles.input} type="password" placeholder={`Kata sandi baru (min. ${minLength} karakter)`} value={next} onChange={(event) => setNext(event.target.value)} autoComplete="new-password" required />
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
