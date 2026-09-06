export interface StorageEstimateResult {
  usageBytes: number;
  quotaBytes: number;
  isPersisted: boolean;
}

export async function getStorageEstimate(): Promise<StorageEstimateResult | null> {
  if (!('storage' in navigator) || typeof navigator.storage.estimate !== 'function') return null;
  const estimate = await navigator.storage.estimate();
  const isPersisted = typeof navigator.storage.persisted === 'function' ? await navigator.storage.persisted() : false;
  return { usageBytes: estimate.usage ?? 0, quotaBytes: estimate.quota ?? 0, isPersisted };
}

/** Best-effort — support and the resulting behavior (esp. on iOS) are inconsistent, so callers should never depend on this succeeding. */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!('storage' in navigator) || typeof navigator.storage.persist !== 'function') return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function clearRuntimeCaches(): Promise<void> {
  if (!('caches' in window)) return;
  const keys = await caches.keys();
  await Promise.all(keys.map((key) => caches.delete(key)));
}
