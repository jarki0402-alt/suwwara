import { useMemo } from 'react';
import { create } from 'zustand';

/**
 * Suwwara's two languages (2026-11). Indonesian is written straight into the code and IS the key: `t('Putar')` shows
 * "Putar" in Indonesian and looks the text up in the English dictionary (src/i18n/en) otherwise. Gettext-style keys
 * instead of ids because the app was written in Indonesian first and this keeps every component readable as it was,
 * and because text that arrives from the server in Indonesian (sign-in errors) can be translated with the same lookup.
 *
 * No i18n library on purpose: this file plus a dictionary is all it takes, and the English dictionary is its own chunk,
 * downloaded only by people who use English, so Indonesian users carry zero extra bytes.
 */
export type Locale = 'id' | 'en';
/** "Bahasa" in Pengaturan. Otomatis follows the device's language. */
export type LanguageChoice = 'auto' | Locale;
export type Plural = { one: string; other: string };
export type Dictionary = Record<string, string | Plural>;
export type TranslateVars = Record<string, string | number>;
export type Translate = (source: string, vars?: TranslateVars) => string;

const STORAGE_KEY = 'suwwara-language';

interface StoredChoice {
  choice: LanguageChoice;
  /** When the choice was made, so the newest one wins when another device syncs a different choice (profileSync). 0 = never chosen. */
  at: number;
}

function readStored(): StoredChoice {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<StoredChoice> | null;
    if (raw && (raw.choice === 'auto' || raw.choice === 'id' || raw.choice === 'en')) return { choice: raw.choice, at: Number(raw.at) || 0 };
  } catch {
    // private mode / blocked storage: fall through to the device language
  }
  return { choice: 'auto', at: 0 };
}

function writeStored(value: StoredChoice): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // not fatal: the choice still applies for this session
  }
}

/** English only for a device whose first language is English; everyone else (Indonesian, Malay, Javanese, ...) gets Indonesian. */
export function deviceLocale(): Locale {
  const languages = typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];
  return (languages[0] ?? '').toLowerCase().startsWith('en') ? 'en' : 'id';
}

const resolve = (choice: LanguageChoice): Locale => (choice === 'auto' ? deviceLocale() : choice);

interface LanguageState extends StoredChoice {
  /** The language actually shown. Stays 'id' until the English dictionary has arrived, so nothing renders half-translated. */
  locale: Locale;
  dict: Dictionary | null;
}

const initial = readStored();
export const useLanguageStore = create<LanguageState>()(() => ({ ...initial, locale: 'id', dict: null }));

let loading: Promise<Dictionary> | null = null;
function loadEnglish(): Promise<Dictionary> {
  loading ??= import('./en').then((module) => module.en);
  return loading;
}

async function apply(choice: LanguageChoice, at: number): Promise<void> {
  const wanted = resolve(choice);
  useLanguageStore.setState({ choice, at });
  if (wanted === 'en') {
    try {
      const dict = await loadEnglish();
      // A newer choice may have landed while the dictionary downloaded.
      if (useLanguageStore.getState().at !== at || useLanguageStore.getState().choice !== choice) return;
      useLanguageStore.setState({ locale: 'en', dict });
    } catch {
      loading = null; // offline on first use: stay Indonesian, the next attempt retries the download
      return;
    }
  } else {
    useLanguageStore.setState({ locale: 'id' });
  }
  document.documentElement.lang = useLanguageStore.getState().locale;
}

/** Before the first render (main.tsx): waits for the English dictionary only when it is needed, so Indonesian boots as before. */
export function initLanguage(): Promise<void> {
  const { choice, at } = useLanguageStore.getState();
  const ready = apply(choice, at);
  window.addEventListener('languagechange', () => {
    if (useLanguageStore.getState().choice === 'auto') void apply('auto', useLanguageStore.getState().at);
  });
  return ready;
}

/** Pengaturan → Bahasa, or a newer choice synced from another device (`at` given). */
export function setLanguageChoice(choice: LanguageChoice, at = Date.now()): Promise<void> {
  writeStored({ choice, at });
  return apply(choice, at);
}

function fill(text: string, vars?: TranslateVars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}

/**
 * Translates Indonesian `source` into the current language. Placeholders are `{name}`; an English entry may be
 * `{ one, other }`, picked by the `n` var ("1 song" / "2 songs"; Indonesian has no plural). Unknown text is shown as is.
 * Outside React (toasts, store code) call this directly; inside a component use `useT()` so a language switch re-renders.
 */
export function t(source: string, vars?: TranslateVars): string {
  const { locale, dict } = useLanguageStore.getState();
  if (locale === 'en' && dict) {
    const entry = dict[source];
    if (typeof entry === 'string') return fill(entry, vars);
    if (entry) return fill(vars?.n === 1 ? entry.one : entry.other, vars);
  }
  return fill(source, vars);
}

/**
 * Marks Indonesian text that is translated later, by `t(value)` at render time: labels in module-level constants,
 * titles stored in data. Does nothing at runtime; tests/i18n/translations.test.ts uses it (and every `t('...')`) to
 * check the English dictionary has an entry for each.
 */
export const msg = (source: string): string => source;

/** `t` for components. A new function per language, so memos that list it in their deps recompute on a switch. */
export function useT(): Translate {
  const locale = useLanguageStore((state) => (state.dict ? state.locale : 'id'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo<Translate>(() => (source, vars) => t(source, vars), [locale]);
}

export function useLocale(): Locale {
  return useLanguageStore((state) => (state.dict ? state.locale : 'id'));
}

/** For Intl formatters (dates, numbers): build them per call or per locale, not once at module load. */
export function intlLocale(locale: Locale = useLanguageStore.getState().locale): string {
  return locale === 'en' ? 'en-US' : 'id-ID';
}
