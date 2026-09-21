import { useState, type FormEvent } from 'react';
import { signIn, useAuthStore } from '../../auth/authStore';
import { Icon, type IconName } from '../../components/Icon/Icon';
import styles from './AuthScreens.module.css';

const FEATURES: { icon: IconName; title: string; sub: string }[] = [
  { icon: 'users', title: 'Dengerin bareng', sub: 'Satu antrean, semua orang ikut mengontrol — real-time.' },
  { icon: 'devices', title: 'Kendalikan perangkat lain', sub: 'Pindahkan lagu antara HP dan laptop, tanpa scan apa pun.' },
  { icon: 'refresh', title: 'Sama di mana saja', sub: 'Playlist, riwayat, dan rekomendasi ikut ke semua perangkatmu.' },
];

/** What a signed-out visitor sees: the app in three lines, and the sign-in form. There is no sign-up — accounts are made by the admin. */
export function LandingPage() {
  const offline = useAuthStore((state) => state.offline);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await signIn(username, password);
    if (!result.ok) {
      setError(result.message);
      setPassword('');
    }
    setBusy(false);
  };

  return (
    <div className={styles.page}>
      <div className={styles.layout}>
        <section className={styles.hero}>
          <span className={styles.brand}>
            <span className={styles.brandMark}>
              <Icon name="pulse" size={16} />
            </span>
            Suwwara
          </span>
          <h1 className={styles.headline}>
            Musikmu, <span>di mana pun</span> kamu mendengar.
          </h1>
        </section>

        <form className={styles.card} onSubmit={(event) => void handleSubmit(event)}>
          <h2 className={styles.cardTitle}>Masuk</h2>
          <p className={styles.cardSub}>Pakai akun yang dibuatkan admin.</p>

          <label className={styles.field}>
            <span className={styles.label}>Nama pengguna</span>
            <input
              className={styles.input}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>Kata sandi</span>
            <span className={styles.inputWrap}>
              <input
                className={styles.input}
                type={reveal ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
              <button type="button" className={styles.reveal} onClick={() => setReveal((value) => !value)}>
                {reveal ? 'Sembunyikan' : 'Tampilkan'}
              </button>
            </span>
          </label>

          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          {offline && !error && <p className={styles.notice}>Tidak ada koneksi ke server — periksa internetmu.</p>}

          <button type="submit" className={styles.submit} disabled={busy || !username || !password}>
            {busy ? 'Memeriksa…' : 'Masuk'}
          </button>
          <p className={styles.footnote}>Belum punya akun? Minta admin membuatkannya.</p>
        </form>

        {/* After the form on a phone, so signing in never needs a scroll; beside the headline on desktop. */}
        <section className={styles.extras}>
          <p className={styles.lead}>Putar tanpa iklan, dengerin bareng teman, dan lanjutkan dari perangkat mana saja — ringan, cepat, dan selalu sinkron.</p>
          <ul className={styles.features}>
            {FEATURES.map((feature) => (
              <li key={feature.title} className={styles.feature}>
                <span className={styles.featureIcon}>
                  <Icon name={feature.icon} size={18} />
                </span>
                <span className={styles.featureText}>
                  <span className={styles.featureTitle}>{feature.title}</span>
                  <span className={styles.featureSub}>{feature.sub}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className={styles.mock} aria-hidden="true">
            <span className={styles.mockArt} />
            <span className={styles.mockBody}>
              <span className={styles.mockLine} />
              <span className={styles.mockLine} />
              <span className={styles.mockBar} />
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}
