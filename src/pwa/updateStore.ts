import { create } from 'zustand';

export type UpdateStatus = 'idle' | 'checking' | 'latest' | 'available' | 'error' | 'unsupported';

interface UpdateState {
  status: UpdateStatus;
  /** When the last manual or background check finished, ms since epoch. */
  checkedAt: number | null;
  set: (status: UpdateStatus) => void;
  /** The update notice (UpdateNotice): opened as a card, or closed down to the small "Update" island. */
  noticeOpen: boolean;
  /** Closed with its × for this session (Pengaturan still offers the update). */
  noticeHidden: boolean;
  setNoticeOpen: (open: boolean) => void;
  hideNotice: () => void;
}

/**
 * Where the app stands on updates. Lives in a store (not in the toast) because the toast that announces a new
 * version disappears after a few seconds — while this stays put until the update is applied, so Pengaturan can
 * always say "versi baru tersedia" and offer the button.
 */
export const useUpdateStore = create<UpdateState>((set) => ({
  status: 'idle',
  checkedAt: null,
  set: (status) => set({ status, checkedAt: status === 'latest' || status === 'available' || status === 'error' ? Date.now() : null }),
  noticeOpen: true,
  noticeHidden: false,
  setNoticeOpen: (noticeOpen) => set({ noticeOpen }),
  hideNotice: () => set({ noticeHidden: true }),
}));
