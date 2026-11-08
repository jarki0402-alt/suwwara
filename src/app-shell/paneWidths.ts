/**
 * The two resizable desktop panes: the left sidebar and the docked Now Playing panel on the right.
 * Their widths live in the --sidebar-width / --now-playing-panel-width custom properties every layout
 * rule already reads (the sidebar, the main column's padding, the mini player's left edge, the panel
 * itself), so resizing is just rewriting a variable — no component has to know. Remembered per browser.
 */
export type Pane = 'sidebar' | 'panel';

export const PANE_LIMITS: Record<Pane, { min: number; max: number; default: number; cssVar: string }> = {
  sidebar: { min: 200, max: 340, default: 232, cssVar: '--sidebar-width' },
  panel: { min: 300, max: 560, default: 380, cssVar: '--now-playing-panel-width' },
};

const STORAGE_KEY = 'suwwara-pane-widths';

/*
 * The sidebar folds down to its icons (Spotify's collapsed library): drag its edge past COLLAPSE_BELOW_PX and it snaps
 * to SIDEBAR_COLLAPSED_PX; drag it back out past the same point and it snaps open at its minimum. A snap rather than a
 * smooth range on purpose: between ~90px and 200px neither the labels nor the icons fit well, so no width there is
 * worth stopping at. Marked on <html data-sidebar="collapsed"> so the CSS can switch the layout without React.
 */
export const SIDEBAR_COLLAPSED_PX = 88;
const COLLAPSE_BELOW_PX = 150;
const sidebarListeners = new Set<() => void>();

export function isSidebarCollapsed(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.sidebar === 'collapsed';
}

/** For useSyncExternalStore: notified when the sidebar folds or unfolds. */
export function subscribeSidebar(listener: () => void): () => void {
  sidebarListeners.add(listener);
  return () => sidebarListeners.delete(listener);
}

function markSidebarCollapsed(collapsed: boolean): void {
  if (collapsed === isSidebarCollapsed()) return;
  if (collapsed) document.documentElement.dataset.sidebar = 'collapsed';
  else delete document.documentElement.dataset.sidebar;
  for (const listener of sidebarListeners) listener();
}

export function clampPane(pane: Pane, px: number): number {
  const { min, max } = PANE_LIMITS[pane];
  return Math.min(Math.max(Math.round(px), min), max);
}

export function setPaneWidth(pane: Pane, px: number): number {
  const collapse = pane === 'sidebar' && px < COLLAPSE_BELOW_PX;
  if (pane === 'sidebar') markSidebarCollapsed(collapse);
  const width = collapse ? SIDEBAR_COLLAPSED_PX : clampPane(pane, px);
  document.documentElement.style.setProperty(PANE_LIMITS[pane].cssVar, `${width}px`);
  return width;
}

export function currentPaneWidth(pane: Pane): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(PANE_LIMITS[pane].cssVar);
  return Number.parseFloat(raw) || PANE_LIMITS[pane].default;
}

export function savePaneWidths(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sidebar: currentPaneWidth('sidebar'), panel: currentPaneWidth('panel') }));
  } catch {
    // private mode / quota: the widths just won't survive a reload
  }
}

/** Applied before the first render so the layout never flashes at the default widths. */
export function applySavedPaneWidths(): void {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Record<Pane, number>>;
    for (const pane of ['sidebar', 'panel'] as const) {
      if (typeof saved[pane] === 'number') setPaneWidth(pane, saved[pane]!);
    }
  } catch {
    // corrupt value — keep the defaults
  }
}

export function resetPaneWidth(pane: Pane): void {
  setPaneWidth(pane, PANE_LIMITS[pane].default);
  savePaneWidths();
}

/** The sidebar's fold button: icons only, or back to the width it had (its default if it was folded at start). */
let widthBeforeCollapse: number = PANE_LIMITS.sidebar.default;
export function toggleSidebarCollapsed(): void {
  if (isSidebarCollapsed()) {
    setPaneWidth('sidebar', widthBeforeCollapse);
  } else {
    widthBeforeCollapse = currentPaneWidth('sidebar');
    setPaneWidth('sidebar', SIDEBAR_COLLAPSED_PX);
  }
  savePaneWidths();
}
