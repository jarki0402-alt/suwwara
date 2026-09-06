import { create } from 'zustand';
import { clearHistory, loadHistory, recordPlay, type PlayEvent } from '../recommendation/historyLog';

interface HistoryState {
  events: PlayEvent[];
  record: (event: PlayEvent) => void;
  clear: () => void;
}

/** Thin reactive wrapper over historyLog's own localStorage-backed ring buffer (own key, capped writes). */
export const useHistoryStore = create<HistoryState>((set) => ({
  events: loadHistory(),
  record: (event) => set({ events: recordPlay(event) }),
  clear: () => {
    clearHistory();
    set({ events: [] });
  },
}));
