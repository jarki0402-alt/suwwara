import { useEffect } from 'react';
import { useSettingsStore } from '../stores/settingsStore';

const LIGHT_THEME_COLOR = '#ffffff';
const DARK_THEME_COLOR = '#0b0b0f';

function applyThemeColorMeta(isDark: boolean): void {
  const color = isDark ? DARK_THEME_COLOR : LIGHT_THEME_COLOR;
  // Both static <meta name="theme-color" media="..."> tags in index.html get the same
  // content here, so whichever one the browser treats as "active" for the current OS
  // setting is irrelevant — the status bar tint always matches the resolved theme.
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    meta.setAttribute('content', color);
  });
}

/**
 * Applies the user's theme preference (system/light/dark, from Settings) to
 * <html data-theme> — see theme.css for how that attribute overrides the
 * prefers-color-scheme media query — and keeps the browser chrome color
 * (mobile status bar tint) in sync with whichever theme actually ends up showing.
 */
export function useThemeSync(): void {
  const theme = useSettingsStore((state) => state.theme);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') {
      delete root.dataset.theme;
    } else {
      root.dataset.theme = theme;
    }

    if (theme !== 'system') {
      applyThemeColorMeta(theme === 'dark');
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    applyThemeColorMeta(mediaQuery.matches);
    const handleChange = (event: MediaQueryListEvent) => applyThemeColorMeta(event.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme]);
}
