const TITLE_NOISE_PATTERNS: RegExp[] = [
  /\(\s*official\s*(music\s*)?video\s*\)/gi,
  /\[\s*official\s*(music\s*)?video\s*\]/gi,
  /\(\s*official\s*(lyric\s*)?audio\s*\)/gi,
  /\[\s*official\s*(lyric\s*)?audio\s*\]/gi,
  /\(\s*official\s*lyric\s*video\s*\)/gi,
  /\[\s*official\s*lyric\s*video\s*\]/gi,
  /\(\s*lyrics?\s*video\s*\)/gi,
  /\[\s*lyrics?\s*video\s*\]/gi,
  /\(\s*lyrics?\s*\)/gi,
  /\[\s*lyrics?\s*\]/gi,
  /\(\s*visualizer\s*\)/gi,
  /\[\s*visualizer\s*\]/gi,
  /\(\s*audio\s*\)/gi,
  /\[\s*audio\s*\]/gi,
  /\bofficial\s*(music\s*)?video\b/gi,
  /\bofficial\s*audio\b/gi,
  /\b(hd|4k|hq)\b/gi,
].map((p) => new RegExp(p));

/** Strips noisy YouTube title decoration ("(Official Video)", "[Lyrics]", etc.) for cleaner display and better lyrics-matching accuracy. */
export function cleanTitle(rawTitle: string): string {
  let cleaned = rawTitle;
  for (const pattern of TITLE_NOISE_PATTERNS) {
    cleaned = cleaned.replace(pattern, '');
  }
  return cleaned.replace(/[\s\-–|]+$/g, '').replace(/\s{2,}/g, ' ').trim();
}

/**
 * YouTube auto-generates a "<Artist> - Topic" channel for every artist in a
 * licensed catalog, uploading clean official audio with no visual content —
 * this is the same signal music bots/apps use to find real official audio
 * instead of fan covers, reactions, or remixes.
 */
export function isTopicChannel(channelName: string): boolean {
  return /-\s*topic$/i.test(channelName.trim());
}

/**
 * Official VEVO/label channel handles are commonly a concatenated
 * PascalCase name with no spaces (e.g. "OliviaRodrigoVEVO") — this strips
 * the VEVO suffix and reinserts word spacing so "OliviaRodrigoVEVO" becomes
 * "Olivia Rodrigo" instead of leaking the raw handle into the UI and into
 * the LRCLIB lyrics query (where it would silently fail to match).
 */
export function cleanChannelName(rawName: string): string {
  let name = rawName.replace(/\s*-\s*topic$/i, '').trim();
  name = name.replace(/^@/, '');
  name = name.replace(/vevo$/i, '').trim();

  if (name.length > 0 && !name.includes(' ') && /[a-z0-9][A-Z]/.test(name)) {
    name = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim();
  }

  return name.length > 0 ? name : rawName.trim();
}
