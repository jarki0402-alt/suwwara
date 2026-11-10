import { create } from 'zustand';

/**
 * The colour the open artist/album/playlist page took from its picture (hooks/useImageTint), handed to the page's
 * scroll container (AppShell's <main>). Painted there and not inside the page so it fills the whole panel to the
 * bottom, like Apple Music.
 */
interface PageTintState {
  tint: string | null;
  setTint: (tint: string | null) => void;
}

export const usePageTintStore = create<PageTintState>()((set) => ({
  tint: null,
  setTint: (tint) => set({ tint }),
}));
