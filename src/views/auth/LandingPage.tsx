import { useState, type FormEvent } from 'react';
import { signIn, useAuthStore } from '../../auth/authStore';
import { Icon, type IconName } from '../../components/Icon/Icon';
import { msg, useT } from '../../i18n/i18n';
import { useBubbleRipple } from '../../hooks/useBubbleRipple';
import styles from './AuthScreens.module.css';

const FEATURES: { icon: IconName; title: string; sub: string }[] = [
  { icon: 'users', title: msg('Dengerin bareng'), sub: msg('Satu antrean buat semua orang, dan siapa saja bisa ikut kontrol, langsung kerasa real-time.') },
  { icon: 'devices', title: msg('Kendalikan perangkat lain'), sub: msg('Lagi asyik di HP, mau lanjut di laptop? Tinggal pindahkan, tanpa scan apa pun.') },
  { icon: 'refresh', title: msg('Sama di mana saja'), sub: msg('Playlist, riwayat dengerin, sampai rekomendasi, semuanya ikut ke perangkat mana pun kamu buka.') },
];

/** What a signed-out visitor sees: the app in three lines, and the sign-in form. There is no sign-up — accounts are made by the admin. */
export function LandingPage() {
  const t = useT();
  const offline = useAuthStore((state) => state.offline);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitRipple = useBubbleRipple<HTMLButtonElement>();

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
          {/* One sentence for the translator, with the highlighted words in [brackets], since word order differs per language. */}
          <h1 className={styles.headline}>
            {t('Musikmu, [ke mana pun] kamu pergi.')
              .split(/\[(.*?)\]/)
              .map((part, index) => (index % 2 === 1 ? <span key={index}>{part}</span> : part))}
          </h1>
        </section>

        <form className={styles.card} onSubmit={(event) => void handleSubmit(event)}>
          <h2 className={styles.cardTitle}>{t('Masuk')}</h2>
          <p className={styles.cardSub}>{t('Sudah dibuatkan akun? Masuk di sini.')}</p>

          <label className={styles.field}>
            <span className={styles.label}>{t('Nama pengguna')}</span>
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
            <span className={styles.label}>{t('Kata sandi')}</span>
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
                {reveal ? t('Sembunyikan') : t('Tampilkan')}
              </button>
            </span>
          </label>

          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          {offline && !error && <p className={styles.notice}>{t('Tidak ada koneksi ke server. Periksa internetmu.')}</p>}

          <button
            ref={submitRipple.ref}
            type="submit"
            className={styles.submit}
            onPointerDown={submitRipple.onPointerDown}
            disabled={busy || !username || !password}
          >
            {busy ? t('Memeriksa…') : t('Masuk')}
          </button>
          <p className={styles.footnote}>{t('Belum kebagian akun? Tinggal minta ke admin.')}</p>
        </form>

        {/* After the form on a phone, so signing in never needs a scroll; beside the headline on desktop. */}
        <section className={styles.extras}>
          <p className={styles.lead}>{t('Bebas iklan, dengerin bareng orang-orang terdekat, dan lanjut persis dari titik terakhir, di HP, laptop, atau di mana saja.')}</p>
          <ul className={styles.features}>
            {FEATURES.map((feature) => (
              <li key={feature.title} className={styles.feature}>
                <span className={styles.featureIcon}>
                  <Icon name={feature.icon} size={18} />
                </span>
                <span className={styles.featureText}>
                  <span className={styles.featureTitle}>{t(feature.title)}</span>
                  <span className={styles.featureSub}>{t(feature.sub)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
