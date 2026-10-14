import { useEffect } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { useGlassTier } from './glassQuality';

// The status bar takes the palette's own background (read back from the resolved token), so a warm palette doesn't
// sit under a pure-white or pure-black strip.
function applyThemeColorMeta(): void {
  const color = getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim() || '#ffffff';
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
  const palette = useSettingsStore((state) => state.palette);
  const glassTint = useSettingsStore((state) => state.glassTint);
  const glassTier = useGlassTier();

  // The Liquid Glass slider moves every glass surface along one line, Bening (0) ↔ Berwarna (1):
  // tint and frost rise together toward Berwarna (factors theme.css/variables.css multiply into
  // --glass-bg* and --blur-*), while the lens (useLiquidRim) fades out. Berwarna = the full 44px
  // frost; the blur curve stays low through the middle so the lens is actually visible there.
  // Efek Kaca "Mati" (data-glass="off", global.css) drops every backdrop filter; without a frost behind it a clear
  // tint would leave text over busy album art unreadable, so the fill goes near-opaque (glass-bg reaches its 0.96 cap in both themes).
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.glass = glassTier;
    // At Bening both reach (almost) zero: no frost, the faintest tint, only the lens.
    root.style.setProperty('--glass-alpha-factor', String(glassTier === 'off' ? 1.7 : 0.05 + 1.15 * glassTint));
    root.style.setProperty('--glass-blur-factor', String(glassTint ** 1.6));
  }, [glassTint, glassTier]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.palette = palette;
    if (theme === 'system') {
      delete root.dataset.theme;
    } else {
      root.dataset.theme = theme;
    }
    applyThemeColorMeta();

    if (theme !== 'system') return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', applyThemeColorMeta);
    return () => mediaQuery.removeEventListener('change', applyThemeColorMeta);
  }, [theme, palette]);
}
