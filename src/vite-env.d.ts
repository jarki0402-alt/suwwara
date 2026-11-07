/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** Build timestamp injected by vite.config.ts. */
declare const __APP_BUILD__: string;

// hls.js ships its light build (no subtitles/DRM/alternate audio: a muted video needs none of it, ~40% smaller)
// without its own type entry; it is the same API as the full build.
declare module 'hls.js/light' {
  export * from 'hls.js';
  export { default } from 'hls.js';
}
