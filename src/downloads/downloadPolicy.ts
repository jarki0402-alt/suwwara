/** Choices offered in Pengaturan → Tersimpan Offline (megabytes) — one shared budget for everything kept
 * locally: deliberate downloads (permanent) and the opportunistic cache (auto, evictable) both draw from it.
 * See AudioCache.enforceLimits() for how the two divide it up. */
export const OFFLINE_QUOTA_OPTIONS_MB = [250, 500, 1024, 2048, 5120] as const;
export const DEFAULT_OFFLINE_QUOTA_MB = 1024;
