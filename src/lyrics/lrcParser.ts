export interface LrcLine {
  time: number;
  text: string;
}

const TAG_RE = /\[(\d{2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

/** Parses standard LRC text into sorted {time, text} lines. Handles multiple timestamp tags per line (repeated chorus). */
export function parseLrc(raw: string): LrcLine[] {
  const lines: LrcLine[] = [];

  for (const rawLine of raw.split(/\r?\n/)) {
    const tags = [...rawLine.matchAll(TAG_RE)];
    if (tags.length === 0) continue;
    const text = rawLine.replace(TAG_RE, '').trim();

    for (const tag of tags) {
      const minutes = Number(tag[1]);
      const seconds = Number(tag[2]);
      const fraction = tag[3] ? Number(tag[3].padEnd(3, '0').slice(0, 3)) / 1000 : 0;
      lines.push({ time: minutes * 60 + seconds + fraction, text });
    }
  }

  return lines.sort((a, b) => a.time - b.time);
}
