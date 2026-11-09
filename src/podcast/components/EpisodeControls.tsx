import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon/Icon';
import { Modal } from '../../components/Modal/Modal';
import modal from '../../components/Modal/Modal.module.css';
import { useLocale, useT } from '../../i18n/i18n';
import { SPEEDS, usePodcastStore } from '../podcastStore';
import { useJamStore } from '../../stores/jamStore';
import styles from './EpisodeControls.module.css';

/** "1,25×" in Indonesian, "1.25×" in English. */
export function formatSpeed(speed: number, locale: string): string {
  return `${speed.toLocaleString(locale === 'en' ? 'en-US' : 'id-ID', { maximumFractionDigits: 2 })}×`;
}

/** Cycles the listening speed (episodes only; songs always play at 1×). */
export function SpeedButton({ className }: { className?: string }) {
  const t = useT();
  const locale = useLocale();
  const speed = usePodcastStore((state) => state.speed);
  const setSpeed = usePodcastStore((state) => state.setSpeed);
  // In a Jam everyone plays at 1x (usePodcastPlayback): the button shows that and does nothing.
  const inJam = useJamStore((state) => state.role !== 'solo');
  const shown = inJam ? 1 : speed;
  const next = SPEEDS[(SPEEDS.indexOf(speed as (typeof SPEEDS)[number]) + 1) % SPEEDS.length] ?? 1;
  return (
    <button
      type="button"
      className={[styles.speed, shown !== 1 ? styles.active : '', className ?? ''].join(' ')}
      onClick={() => setSpeed(next)}
      disabled={inJam}
      title={inJam ? t('Saat Jam, semua mendengar dengan kecepatan normal') : undefined}
      aria-label={t('Kecepatan putar {speed}', { speed: formatSpeed(shown, locale) })}
    >
      {formatSpeed(shown, locale)}
    </button>
  );
}

const SLEEP_MINUTES = [15, 30, 45, 60] as const;

function useMinutesLeft(endsAt: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [endsAt]);
  return endsAt ? Math.max(1, Math.ceil((endsAt - now) / 60_000)) : null;
}

/** Sleep timer: pauses after the chosen minutes (usePodcastPlayback runs the timer). */
export function SleepButton({ className }: { className?: string }) {
  const t = useT();
  const sleep = usePodcastStore((state) => state.sleep);
  const setSleep = usePodcastStore((state) => state.setSleep);
  const [open, setOpen] = useState(false);
  const inJam = useJamStore((state) => state.role !== 'solo');
  const minutesLeft = useMinutesLeft(inJam ? null : (sleep?.endsAt ?? null));
  const pick = (minutes: number | null) => {
    setSleep(minutes ? { endsAt: Date.now() + minutes * 60_000, endOfEpisode: false } : null);
    setOpen(false);
  };
  return (
    <>
      <button
        type="button"
        className={[styles.sleep, sleep && !inJam ? styles.active : '', className ?? ''].join(' ')}
        onClick={() => setOpen(true)}
        disabled={inJam}
        title={inJam ? t('Timer tidur tidak berlaku saat Jam') : undefined}
        aria-label={sleep ? t('Timer tidur, sisa {n} menit', { n: minutesLeft ?? 0 }) : t('Timer tidur')}
      >
        <Icon name="moon" size={22} />
        {minutesLeft !== null && <span className={styles.badge}>{minutesLeft}</span>}
      </button>
      <Modal isOpen={open} onClose={() => setOpen(false)} label={t('Timer tidur')}>
        <span className={modal.title}>{t('Timer tidur')}</span>
        <p className={modal.text}>{t('Pemutaran berhenti sendiri setelah waktu ini.')}</p>
        <div className={styles.options}>
          {SLEEP_MINUTES.map((minutes) => (
            <button key={minutes} type="button" className={styles.option} onClick={() => pick(minutes)}>
              {minutes === 60 ? t('1 jam') : t('{n} menit', { n: minutes })}
            </button>
          ))}
          {sleep && (
            <button type="button" className={[styles.option, styles.optionOff].join(' ')} onClick={() => pick(null)}>
              {t('Matikan timer')}
            </button>
          )}
        </div>
      </Modal>
    </>
  );
}
