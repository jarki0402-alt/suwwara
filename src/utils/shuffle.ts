/**
 * Builds a play-order permutation over `length` indices. When shuffled, the
 * given `anchorIndex` (the currently playing song, if any) is pinned to the
 * front so toggling shuffle mid-track never changes what's currently playing —
 * only the songs that come after it.
 */
export function buildPlayOrder(length: number, shuffle: boolean, anchorIndex: number): number[] {
  const indices = Array.from({ length }, (_, i) => i);
  if (!shuffle) return indices;

  const rest = indices.filter((i) => i !== anchorIndex);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }

  return indices.includes(anchorIndex) ? [anchorIndex, ...rest] : rest;
}
