export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID (older WebViews on low-end Android).
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
