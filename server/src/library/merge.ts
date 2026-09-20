/**
 * Union of two library snapshots, used when two accounts become one (a device is linked) and
 * when a device saves on top of a newer version. Nothing is dropped: a song liked on either
 * side stays liked, a playlist from either side is kept. On an id collision `preferred` wins.
 *
 * Deletions are the price of this: a song removed on one side and still present on the other
 * comes back after a merge. Tracking removals needs per-item tombstones, which is more than a
 * closed circle sharing one person's library needs — and losing a like is worse than a like
 * reappearing.
 */
export interface LibrarySnapshotData {
  likedSongs: Array<{ id: string; [key: string]: unknown }>;
  playlists: Array<{ id: string; [key: string]: unknown }>;
}

function unionById<T extends { id: string }>(preferred: T[], other: T[]): T[] {
  const seen = new Set(preferred.map((item) => item.id));
  return [...preferred, ...other.filter((item) => !seen.has(item.id))];
}

export function mergeLibraries(preferred: LibrarySnapshotData, other: LibrarySnapshotData): LibrarySnapshotData {
  return {
    likedSongs: unionById(preferred.likedSongs, other.likedSongs),
    playlists: unionById(preferred.playlists, other.playlists),
  };
}
