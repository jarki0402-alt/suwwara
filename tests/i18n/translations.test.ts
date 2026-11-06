import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { areas, en } from '../../src/i18n/en';
import { t, useLanguageStore } from '../../src/i18n/i18n';

/**
 * Guards for the two languages (src/i18n): every Indonesian text the app translates has English, placeholders survive
 * the translation, and no new screen text slips in untranslated (raw JSX text or a plain aria-label/placeholder).
 * The admin console is Indonesian-only by decision, so it is skipped.
 */
const ROOT = join(__dirname, '../..');
const SKIP_DIRS = new Set(['src/views/admin', 'src/i18n']);
// Text that is the same in both languages: the name, and characters that are not words.
const SAME_IN_BOTH = new Set(['Suwwara']);
const TEXT_ATTRIBUTES = new Set(['aria-label', 'placeholder', 'title', 'label', 'alt', 'subtitle', 'aria-description']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (SKIP_DIRS.has(relative(ROOT, path))) return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith('.d.ts') ? [path] : [];
  });
}

interface Scan {
  keys: Map<string, string>;
  problems: string[];
}

function scan(): Scan {
  const keys = new Map<string, string>();
  const problems: string[] = [];
  for (const path of sourceFiles(join(ROOT, 'src'))) {
    const text = readFileSync(path, 'utf8');
    const file = relative(ROOT, path);
    const tsx = path.endsWith('.tsx');
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const where = (node: ts.Node) => `${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`;
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && (node.expression.text === 't' || node.expression.text === 'msg')) {
        const [first] = node.arguments;
        if (first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) keys.set(first.text, where(node));
        else if (first && ts.isTemplateExpression(first)) problems.push(`${where(node)}  ${node.expression.text}() with \${...} inside: use a {placeholder} and vars instead`);
      }
      if (tsx && ts.isJsxText(node)) {
        const value = node.getText(source).trim();
        if (/\p{L}/u.test(value) && !SAME_IN_BOTH.has(value)) problems.push(`${where(node)}  untranslated JSX text: "${value.slice(0, 60)}"`);
      }
      if (tsx && ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
        const name = node.name.getText(source);
        const value = node.initializer.text;
        if (TEXT_ATTRIBUTES.has(name) && /\p{L}/u.test(value) && !SAME_IN_BOTH.has(value)) problems.push(`${where(node)}  untranslated ${name}="${value.slice(0, 60)}"`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { keys, problems };
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().join(',');

describe('translations', () => {
  const { keys, problems } = scan();

  it('every t()/msg() text has English', () => {
    const missing = [...keys].filter(([key]) => !(key in en)).map(([key, at]) => `${at}  "${key}"`);
    expect(missing, `Missing English (add to src/i18n/en/<area>.ts):\n${missing.join('\n')}`).toEqual([]);
  });

  it('no untranslated screen text and no t() built from a template', () => {
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('placeholders are kept in the English text', () => {
    const broken = Object.entries(en).flatMap(([key, value]) => {
      if (typeof value === 'string') return placeholders(value) === placeholders(key) ? [] : [`"${key}" → "${value}"`];
      // A plural's "one" form may spell the number out ("a song"), so {n} is optional in it.
      const withoutN = (text: string) => placeholders(text).split(',').filter((name) => name && name !== 'n').join(',');
      return [value.one, value.other].filter((form) => withoutN(form) !== withoutN(key)).map((form) => `"${key}" → "${form}"`);
    });
    expect(broken).toEqual([]);
  });

  it('the same Indonesian text has the same English in every area', () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const [area, dict] of Object.entries(areas)) {
      for (const [key, value] of Object.entries(dict)) {
        const english = JSON.stringify(value);
        const before = seen.get(key);
        if (before !== undefined && before !== english) clashes.push(`${area}: "${key}"`);
        seen.set(key, english);
      }
    }
    expect(clashes).toEqual([]);
  });

  it('t() translates, fills placeholders and picks plurals', () => {
    useLanguageStore.setState({ locale: 'en', dict: { 'Putar {name}': 'Play {name}', '{n} lagu': { one: '{n} song', other: '{n} songs' } } });
    expect(t('Putar {name}', { name: 'A' })).toBe('Play A');
    expect(t('{n} lagu', { n: 1 })).toBe('1 song');
    expect(t('{n} lagu', { n: 3 })).toBe('3 songs');
    expect(t('Tidak ada di kamus')).toBe('Tidak ada di kamus');
    useLanguageStore.setState({ locale: 'id', dict: null });
    expect(t('Putar {name}', { name: 'A' })).toBe('Putar A');
    expect(t('{n} lagu', { n: 3 })).toBe('3 lagu');
  });
});
