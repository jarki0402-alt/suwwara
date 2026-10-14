import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PALETTES } from '../../src/stores/settingsStore';

// Read from disk: Vitest stubs CSS imports (even ?raw) to empty.
const css = readFileSync(new URL('../../src/styles/theme.css', import.meta.url), 'utf8');
const PRIMITIVES = ['bg', 'elevated', 'sidebar', 'glass', 'text', 'text-2', 'text-3', 'accent', 'accent-rgb', 'accent-strong', 'on-accent'];

function block(id: string): string {
  const start = css.indexOf(`:root[data-palette='${id}']`);
  expect(start, `no [data-palette='${id}'] block in theme.css`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
}

describe('palettes', () => {
  // A palette missing one primitive would silently inherit Simple's value for it — a red accent on Hutan's paper.
  it.each(PALETTES)('%s defines every light and dark primitive', (id) => {
    const body = block(id);
    for (const mode of ['pl', 'pd']) {
      for (const name of PRIMITIVES) expect(body, `--${mode}-${name}`).toMatch(new RegExp(`--${mode}-${name}:`));
    }
  });
});
