import react from '@vitejs/plugin-react';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

// One stamp per build: baked into the bundle (__APP_BUILD__) and written to /version.json.
const BUILD_STAMP = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

// The update check compares the stamp the device is RUNNING with the one the server serves right now, read around every
// cache. A service worker script that a proxy in front keeps serving stale hides a new version from
// registration.update() entirely; this file cannot be hidden that way (no-store in nginx.conf, unique query per check).
// Deliberately not in the SW precache (globPatterns below has no json).
const emitVersion: Plugin = {
  name: 'emit-version',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_STAMP }) });
  },
};

// https://vite.dev/config/
export default defineConfig({
  define: {
    // Shown in Settings -> Diagnostik so it's obvious which build a phone is really running
    // (an installed PWA keeps serving its cached bundle until it is updated).
    __APP_BUILD__: JSON.stringify(BUILD_STAMP),
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
  server: {
    // Forwards /api/* to the local backend (server/) so the frontend can call
    // relative paths regardless of which device/IP it's loaded from — this is
    // what lets a phone on the same Wi-Fi hit /api/... and have it resolve to
    // the backend running on the dev machine, without hardcoding its LAN IP.
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
    emitVersion,
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false,
      registerType: 'prompt',
      includeAssets: ['icons/*.png', 'apple-touch-icon.png'],
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
      manifest: {
        name: 'Suwwara',
        short_name: 'Suwwara',
        description: 'Pemutar musik bebas iklan, ringan, dan smooth — untuk semua perangkat.',
        lang: 'id',
        theme_color: '#0b0b0f',
        background_color: '#0b0b0f',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
});
