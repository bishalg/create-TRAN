// Verifies: REQ-SEC-017 REQ-SEC-018
/**
 * Script-readable storage holds preferences, never a credential (spec 022, ADR-0039). Web Storage
 * is allowed in the preference modules listed below, each with the reason; the inline script in
 * `index.html` may only read the theme's key before first paint. IndexedDB and `document.cookie` are not used at
 * all. A regex guard over the shipped sources, not a type checker: it reads comments too.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { THEME_STORAGE_KEY } from '../src/shared/lib/theme.js';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '../../..');

/** Everything that runs in the browser: the app, the shared SDK and the API client. */
const SOURCE_DIRS = ['apps/web/src', 'packages/core-ts/src', 'packages/api/src'];
const THEME_MODULE = 'apps/web/src/shared/lib/theme.ts';

/** Every module allowed Web Storage, and what it keeps. None holds a credential. */
const PREFERENCE_MODULES: Record<string, string> = {
  [THEME_MODULE]: 'the chosen colour theme (REQ-WEB-014)',
  'apps/web/src/shared/lib/updatePrompt.ts':
    'the recommended version the update prompt was dismissed for (REQ-VER-010)',
};

const STORAGE = /\b(localStorage|sessionStorage|indexedDB|cookieStore)\b|document\.cookie/g;

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** `file:line api` for every storage access in `text`. */
function storageUses(file: string, text: string): string[] {
  return text
    .split('\n')
    .flatMap((line, index) =>
      [...line.matchAll(STORAGE)].map((match) => `${file}:${index + 1} ${match[0]}`)
    );
}

describe('Web Storage holds no credential (REQ-SEC-018)', () => {
  it('finds each kind of script-readable storage', () => {
    const sample = [
      'localStorage.setItem("t", token);',
      'sessionStorage.x = 1; indexedDB.open("db");',
      'document.cookie = "a=b"; await cookieStore.get("a");',
    ].join('\n');
    expect(storageUses('sample.ts', sample)).toEqual([
      'sample.ts:1 localStorage',
      'sample.ts:2 sessionStorage',
      'sample.ts:2 indexedDB',
      'sample.ts:3 document.cookie',
      'sample.ts:3 cookieStore',
    ]);
  });

  it('is used only by the preference modules, and only as localStorage', () => {
    const files = SOURCE_DIRS.flatMap(sources);
    for (const module of Object.keys(PREFERENCE_MODULES)) expect(files).toContain(module);
    const uses = files.flatMap((file) => storageUses(file, readFileSync(join(ROOT, file), 'utf8')));
    const outside = uses.filter(
      (use) => !Object.keys(PREFERENCE_MODULES).some((module) => use.startsWith(`${module}:`))
    );
    expect(outside, 'Web Storage outside the preference modules').toEqual([]);
    expect(uses.length).toBeGreaterThan(0);
    for (const use of uses) expect(use).toMatch(/ localStorage$/);
  });

  it('lets index.html only read the theme key before first paint', () => {
    const file = join(here, '../index.html');
    const html = readFileSync(file, 'utf8');
    const uses = storageUses(relative(ROOT, file), html);
    expect(uses).toHaveLength(1);
    const reads = [...html.matchAll(/localStorage\.(\w+)\(([^)]*)\)/g)];
    expect(reads.map(([, method, key]) => [method, key])).toEqual([
      ['getItem', `'${THEME_STORAGE_KEY}'`],
    ]);
  });
});
