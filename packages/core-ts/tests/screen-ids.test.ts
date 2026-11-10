// Verifies: REQ-SCR-002
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SCREENS, ScreenIds } from '../src/generated/screens.js';

const root = path.resolve(fileURLToPath(import.meta.url), '../../../../');

type Platform = 'web' | 'ios' | 'android';

/** Directories that hold generated or vendored code, never hand-written ids. */
const SKIP = /^(generated|Generated|uniffi|node_modules|build|\.gradle|test-results)$/;

function listFiles(dir: string, extensions: string[]): string[] {
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) return SKIP.test(entry.name) ? [] : listFiles(relative, extensions);
    return extensions.some((extension) => entry.name.endsWith(extension)) ? [relative] : [];
  });
}

const read = (file: string): string => readFileSync(path.join(root, file), 'utf8');

const DECLARED = new Set(SCREENS.flatMap((screen) => screen.elements.map((element) => element.id)));

/**
 * Web atom unit tests check that an atom forwards arbitrary attributes; their `data-testid`s
 * (`box`, `stack`) name no screen element.
 */
const ATOM_TESTS = /^apps\/web\/src\/shared\/ui\/[^/]+\.test\.tsx$/;

/** Sources that address elements, per platform: feature code and every kind of test. */
const SOURCES: Record<Platform, string[]> = {
  web: [
    ...listFiles('apps/web/src', ['.ts', '.tsx']).filter((file) => !ATOM_TESTS.test(file)),
    ...listFiles('e2e/steps', ['.ts']),
  ],
  ios: [...listFiles('apps/ios/Sources', ['.swift']), ...listFiles('apps/ios/Tests', ['.swift'])],
  android: listFiles('apps/android/app/src', ['.kt']),
};

/** A literal element id where the generated constant belongs. Group 1 is the literal. */
const LITERAL_IDS: RegExp[] = [
  /data-testid=\s*["'{`]+([^"'`}]+)["'`]/g,
  /ByTestId\(\s*["'`]([^"'`]+)["'`]/g,
  /accessibilityIdentifier\(\s*"([^"]+)"/g,
  /identifier:\s*"([a-z][a-z0-9]*(?:-[a-z0-9]+)+)"/g,
  /\b(?:textFields|staticTexts|buttons|otherElements|switches|any)\[\s*"([a-z][a-z0-9]*(?:-[a-z0-9]+)*)"\s*\]/g,
  /\b(?:testTag|onNodeWithTag|onAllNodesWithTag|hasTestTag)\(\s*"([^"]+)"/g,
];

/**
 * Any string literal spelled like a multi-word element id (`"check-button"`), wherever it is, except
 * a CSS class name: `className="sign-out-button"` styles the element, it does not address it.
 */
const KEBAB_LITERAL = /(?<!className=)["'`]([a-z][a-z0-9]*(?:-[a-z0-9]+)+)["'`]/g;

const lineOf = (source: string, index: number): number => source.slice(0, index).split('\n').length;

function literalIds(): string[] {
  const found: string[] = [];
  for (const file of Object.values(SOURCES).flat()) {
    const source = read(file);
    for (const pattern of LITERAL_IDS) {
      for (const match of source.matchAll(pattern)) {
        found.push(`${file}:${lineOf(source, match.index)}: ${match[0]}`);
      }
    }
    for (const match of source.matchAll(KEBAB_LITERAL)) {
      if (DECLARED.has(match[1]!))
        found.push(`${file}:${lineOf(source, match.index)}: ${match[0]}`);
    }
  }
  return found;
}

/** Element constants a platform references: `ScreenIds.eligibility.ageField`, `ScreenContract.Eligibility.ageField`. */
const CONSTANT = /\b(?:ScreenIds|ScreenContract)\.(\w+)\.(\w+)\b/g;

const camel = (id: string): string =>
  id.replace(/[-_](\w)/g, (_, letter: string) => letter.toUpperCase());
const pascal = (id: string): string => camel(id).charAt(0).toUpperCase() + camel(id).slice(1);

/** `screen.member` (both platform spellings) → element id, from the catalogue. */
const BY_MEMBER = new Map<string, string>(
  SCREENS.flatMap((screen) =>
    screen.elements.flatMap((element) => [
      [`${camel(screen.id)}.${camel(element.id)}`, element.id],
      [`${pascal(screen.id)}.${camel(element.id)}`, element.id],
    ])
  )
);

function referencedIds(files: string[]): { ids: Set<string>; unknown: string[] } {
  const ids = new Set<string>();
  const unknown: string[] = [];
  for (const file of files) {
    for (const match of read(file).matchAll(CONSTANT)) {
      const id = BY_MEMBER.get(`${match[1]}.${match[2]}`);
      if (id === undefined) {
        if (match[1] !== 'Minimums') unknown.push(`${file}: ${match[0]}`);
      } else ids.add(id);
    }
  }
  return { ids, unknown };
}

/** Maestro stays YAML, so its ids stay literal; they must still be declared. */
function maestroIds(): string[] {
  return listFiles('e2e/maestro', ['.yaml', '.yml']).flatMap((file) =>
    [...read(file).matchAll(/^\s*(?:-\s*)?id:\s*['"]?([\w-]+)['"]?\s*$/gm)].map(
      (match) => match[1]!
    )
  );
}

/**
 * Always-present elements a platform does not implement yet, each with its reason. The guard
 * fails when an entry is no longer a gap, so the list only shrinks.
 */
const KNOWN_GAPS: { platform: Platform; id: string; reason: string }[] = [
  {
    platform: 'web',
    id: 'splash-progress',
    reason: 'the web boot (one refresh call, REQ-SEC-021) renders no splash element',
  },
  {
    platform: 'android',
    id: 'splash-progress',
    reason: 'the Android coordinator resolves the session synchronously, no splash screen',
  },
  // Spec 026: the shared core declares the location control first; the iOS and Android packages
  // add it with their permission gateways and remove these entries (REQ-PRV-007).
];

/** The native scenario interpreters (ADR-0038): they run every scenario of `screens.json`. */
const NATIVE_INTERPRETERS = [
  'apps/ios/Tests/TranVotingDemoUITests/ScreenContractUITests.swift',
  'apps/android/app/src/androidTest/kotlin/com/tran/voting/ui/ScreenContractTest.kt',
];

/** Feature code only: a platform implements an element when its app sources reference it. */
const APP_SOURCES: Record<Platform, string[]> = {
  web: listFiles('apps/web/src', ['.ts', '.tsx']).filter((file) => !/\.test\.tsx?$/.test(file)),
  ios: listFiles('apps/ios/Sources', ['.swift']),
  android: listFiles('apps/android/app/src/main', ['.kt']),
};

describe('screen contract ids', () => {
  it('addresses elements through the generated constants, never a literal', () => {
    expect(literalIds(), 'use ScreenIds (web) / ScreenContract (iOS, Android)').toEqual([]);
  });

  it('uses only ids the contract declares', () => {
    const platforms = Object.values(SOURCES).flat();
    expect(referencedIds(platforms).unknown).toEqual([]);
    expect(maestroIds().filter((id) => !DECLARED.has(id))).toEqual([]);
    expect(maestroIds().length).toBeGreaterThan(0);
    expect(
      Object.values(ScreenIds)
        .flatMap((ids) => Object.values(ids))
        .sort()
    ).toEqual(SCREENS.flatMap((screen) => screen.elements.map((element) => element.id)).sort());
  });

  it('references every always-present element on every platform that offers it', () => {
    const gap = (platform: Platform, id: string): boolean =>
      KNOWN_GAPS.some((entry) => entry.platform === platform && entry.id === id);
    for (const platform of ['web', 'ios', 'android'] as const) {
      // An element another platform offers alone (the web's skip link) is not this one's to expose.
      const always = [
        ...new Set(
          SCREENS.flatMap((screen) =>
            screen.elements
              .filter((e) => e.presence === 'always' && e.platforms.includes(platform))
              .map((e) => e.id)
          )
        ),
      ];
      const { ids } = referencedIds(APP_SOURCES[platform]);
      const missing = always.filter((id) => !ids.has(id) && !gap(platform, id));
      expect(missing, `${platform} never exposes these always-present elements`).toEqual([]);
      const closed = KNOWN_GAPS.filter((entry) => entry.platform === platform && ids.has(entry.id));
      expect(closed, `${platform} implements these now: remove them from KNOWN_GAPS`).toEqual([]);
    }
  });

  // Verifies: REQ-SCR-006 — the native interpreters read their scenarios at run time, so their
  // `// Verifies:` header is written once and must name exactly what the scenarios cite.
  it('cites in each native interpreter every requirement the scenarios tag', () => {
    const tagged = new Set(
      SCREENS.flatMap((screen) => screen.scenarios.flatMap((scenario) => scenario.verifies))
    );
    for (const file of NATIVE_INTERPRETERS) {
      const cited = new Set(
        [...read(file).matchAll(/^\/\/ Verifies:(.*)$/gm)].flatMap((line) =>
          line[1]!.trim().split(/\s+/)
        )
      );
      const own = new Set(['REQ-SCR-006', 'REQ-SCR-007', 'REQ-SCR-008']);
      expect([...cited].filter((id) => !own.has(id)).sort(), file).toEqual([...tagged].sort());
      for (const id of own) expect(cited.has(id), `${file} cites ${id}`).toBe(true);
    }
  });

  it('catches a literal id and an unknown constant', () => {
    const literal = 'Modifier.testTag("check-button")';
    expect(LITERAL_IDS.some((pattern) => [...literal.matchAll(pattern)].length > 0)).toBe(true);
    expect(`app.buttons["check-button"]`.match(LITERAL_IDS[4]!)).not.toBeNull();
    expect(`json["result"]`.match(LITERAL_IDS[4]!)).toBeNull();
    expect(BY_MEMBER.get('Eligibility.checkButton')).toBe('check-button');
    expect(BY_MEMBER.get('eligibility.nope')).toBeUndefined();
  });
});
