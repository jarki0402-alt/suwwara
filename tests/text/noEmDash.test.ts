import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { parseJsonWithoutEmDash, withoutEmDash } from '../../src/utils/noEmDash';

/**
 * House rule: no em dash (U+2014) anywhere in Suwwara's text — from the sign-in page to the deepest settings row,
 * toasts, admin console and server messages included. This scans every string, template and JSX text in the app and
 * the backend (comments are free to use one; nobody sees them) and fails the build's test run on the first one, so a
 * newly written or generated string can't bring it back. Use a comma, a period, a colon or " · " instead.
 */
const ROOT = join(__dirname, '../..');
const EM_DASH = '—';
// The one file that has to name the character: the cleaner that strips it from outside text.
const ALLOWED = new Set(['src/utils/noEmDash.ts']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' || name === 'dist' ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts') ? [path] : [];
  });
}

function emDashesIn(path: string): string[] {
  const text = readFileSync(path, 'utf8');
  if (!text.includes(EM_DASH) && !/\\u2014|&mdash;|&#8212;|&#x2014;/i.test(text)) return [];
  const file = relative(ROOT, path);
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    let value: string | null = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) value = node.text;
    else if (ts.isJsxText(node)) value = node.getText(source);
    if (value !== null && (value.includes(EM_DASH) || /&mdash;|&#8212;|&#x2014;/i.test(value))) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      found.push(`${file}:${line + 1}  ${value.trim().slice(0, 80)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('no em dash in Suwwara text', () => {
  it('none in any string, template or JSX text of the app or the backend', () => {
    const files = [...sourceFiles(join(ROOT, 'src')), ...sourceFiles(join(ROOT, 'server/src')), join(ROOT, 'vite.config.ts')];
    const offenders = files.filter((path) => !ALLOWED.has(relative(ROOT, path))).flatMap(emDashesIn);
    expect(offenders, `Em dash found. Use a comma, period, colon or " · " instead:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('none in the HTML page itself', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    expect(html.includes(EM_DASH) || /&mdash;|&#8212;|&#x2014;/i.test(html)).toBe(false);
  });

  it('none in a CSS content: value (text drawn by a stylesheet)', () => {
    const cssFiles = (function walk(dir: string): string[] {
      return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        return statSync(path).isDirectory() ? walk(path) : name.endsWith('.css') ? [path] : [];
      });
    })(join(ROOT, 'src'));
    const offenders = cssFiles.filter((path) => /content:\s*['"][^'"]*(—|\\2014)/.test(readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')));
    expect(offenders).toEqual([]);
  });

  it('cleans text from outside (titles, lyrics, bios)', () => {
    expect(withoutEmDash('Artist — Title')).toBe('Artist - Title');
    expect(withoutEmDash('a—b')).toBe('a - b');
    expect(withoutEmDash('plain')).toBe('plain');
    expect(parseJsonWithoutEmDash<{ t: string; n: number }>('{"t":"A — B","n":1}')).toEqual({ t: 'A - B', n: 1 });
    expect(parseJsonWithoutEmDash<{ t: string }>('{"t":"A \\u2014 B"}')).toEqual({ t: 'A - B' });
  });
});
