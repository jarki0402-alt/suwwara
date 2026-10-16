/**
 * Suwwara never shows an em dash (U+2014). The app's own copy doesn't use one (enforced by tests/text/noEmDash.test.ts),
 * and this keeps text from outside (YouTube titles, artist and album names, lyrics, Wikipedia bios) the same way.
 * "Artist — Title" reads naturally as "Artist - Title".
 */
const EM_DASH = /\s*—\s*/g;

export function withoutEmDash(text: string): string {
  return text.includes('—') ? text.replace(EM_DASH, ' - ').trim() : text;
}

/**
 * JSON.parse that cleans every string on the way in, but only pays for it when the body actually has an em dash
 * (written out or as a — escape), which is almost never; the usual response is parsed exactly as before.
 */
export function parseJsonWithoutEmDash<T>(body: string): T {
  if (!body.includes('—') && !/\\u2014/i.test(body)) return JSON.parse(body) as T;
  return JSON.parse(body, (_key, value: unknown) => (typeof value === 'string' ? withoutEmDash(value) : value)) as T;
}
