/** The link that opens the app straight into a Jam (see joinJam / the `?jam=` handling at startup). */
export function jamShareLink(roomId: string): string {
  return `${window.location.origin}${window.location.pathname}?jam=${roomId}`;
}

/** Copies the invite link. Resolves false when the browser refuses (no clipboard permission, insecure context). */
export async function copyJamLink(roomId: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(jamShareLink(roomId));
    return true;
  } catch {
    return false;
  }
}
