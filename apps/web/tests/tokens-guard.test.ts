// Verifies: REQ-WEB-010, REQ-WEB-011, REQ-WEB-014
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { themeNames } from '@tran/core';
import { THEME_STORAGE_KEY } from '../src/shared/lib/theme.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (...segments: string[]) => readFileSync(join(here, ...segments), 'utf8');

const appCss = read('../src/styles/app.css');

const themeCss = read('../src/styles/generated/theme.css');
const breakpointNarrow = /--tran-breakpoint-narrow:\s*([^;]+);/.exec(themeCss)?.[1];

interface SnapshotTheme {
  mode: string;
  colorScheme: string;
}

const snapshotThemes = (
  JSON.parse(read('../../../packages/core-ts/src/generated/tokens.json')) as {
    themes: SnapshotTheme[];
  }
).themes;

describe('app.css token guard', () => {
  it('does not use raw hex colours', () => {
    expect(appCss.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
  });

  it('has no var() inside @media conditions (invalid CSS, rule is silently dropped)', () => {
    expect(appCss).not.toMatch(/@media[^{]*var\(/);
  });

  it('uses media breakpoints only when they match the generated token', () => {
    expect(breakpointNarrow).toBeDefined();
    const widths = [...appCss.matchAll(/@media \(max-width: ([^)]+)\)/g)].map((m) => m[1]);
    expect(widths.every((w) => w === breakpointNarrow)).toBe(true);
  });

  it('does not use raw px/rem outside custom-property definitions', () => {
    const rawSize = /[0-9.]+(px|rem)\b/g;
    const offenders: string[] = [];

    for (const line of appCss.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('/*')) continue;
      if (trimmed.includes('--') && trimmed.includes(':')) continue;
      if (trimmed === `@media (max-width: ${breakpointNarrow}) {`) continue;
      const matches = line.match(rawSize);
      if (matches) offenders.push(trimmed);
    }

    expect(offenders).toEqual([]);
  });

  it('generated theme.css terminates every custom property with a semicolon', () => {
    const unterminated = themeCss
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('--tran-') && !line.endsWith(';'));

    expect(unterminated).toEqual([]);
  });
});

describe('theme registry guard', () => {
  it('keeps the snapshot, the generated TS registry and the CSS blocks in sync', () => {
    expect(snapshotThemes.map((theme) => theme.mode)).toEqual([...themeNames]);
    for (const theme of snapshotThemes) {
      const block = new RegExp(`\\[data-theme="${theme.mode}"\\] \\{([^}]*)\\}`).exec(
        themeCss
      )?.[1];
      expect(block, `missing [data-theme="${theme.mode}"] block`).toBeDefined();
      expect(block).toContain(`color-scheme: ${theme.colorScheme};`);
    }
  });

  it('keeps app.css free of per-theme selectors (colours stay in generated theme.css)', () => {
    expect(appCss).not.toMatch(/\[data-theme/);
  });

  it('has no binary theme branching in app code', () => {
    const src = join(here, '../src');
    const files = readdirSync(src, { recursive: true, encoding: 'utf8' }).filter(
      (file) => /\.(ts|tsx)$/.test(file) && !file.includes('.test.')
    );
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(readFileSync(join(src, file), 'utf8'), file).not.toMatch(/\btheme\s*(===|!==)/);
    }
  });

  it('boots the remembered theme before first paint with the shared storage key', () => {
    const html = read('../index.html');
    expect(html).toContain(THEME_STORAGE_KEY);
    expect(html).toMatch(/dataset\.theme/);
  });
});
