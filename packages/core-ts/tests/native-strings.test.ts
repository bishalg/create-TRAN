// Verifies: REQ-NAT-008 REQ-I18N-005 REQ-I18N-006
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(fileURLToPath(import.meta.url), '../../../../');

const localesDir = path.join(root, 'locales');
const iosStringsDir = path.join(root, 'apps/ios/Sources/TranVotingDemo/Generated/Strings');
const iosGeneratedDir = path.join(root, 'apps/ios/Sources/TranVotingDemo/Generated');
const androidGeneratedDir = path.join(
  root,
  'apps/android/app/src/main/kotlin/com/tran/voting/generated'
);
const androidResDir = path.join(root, 'apps/android/app/src/main/res');

/** The locale directories are the single source of truth: add/remove one directory. */
const LOCALES = readdirSync(localesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const MODULES = readdirSync(path.join(localesDir, 'en'))
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.replace(/\.json$/, ''))
  .sort();

interface StringCatalog {
  sourceLanguage: string;
  strings: Record<
    string,
    {
      localizations: Record<string, { stringUnit: { state: string; value: string } }>;
    }
  >;
}

function readText(...segments: string[]): string {
  return readFileSync(path.join(root, ...segments), 'utf8');
}

/** `locales/<locale>/<module>.json` flattened to module-relative `<path>` keys. */
function moduleDictionary(locale: string, module: string): Map<string, string> {
  const out = new Map<string, string>();
  const raw: unknown = JSON.parse(readText('locales', locale, `${module}.json`));
  flatten(raw, '', out);
  return out;
}

function flatten(value: unknown, prefix: string, out: Map<string, string>): void {
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      flatten(child, prefix === '' ? key : `${prefix}.${key}`, out);
    }
    return;
  }
  if (typeof value !== 'string') {
    throw new Error(`locale entry \`${prefix}\` is not a string`);
  }
  out.set(prefix, value);
}

const fullKey = (module: string, relative: string): string => `${module}.${relative}`;

/** `translate.this` → `translateThis`, mirroring the codegen accessor naming rule. */
function memberName(relative: string): string {
  return relative
    .split('.')
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
}

/** `shell.theme.sepia` → `shell_theme_sepia`, mirroring the codegen naming rule. */
function androidResourceName(key: string): string {
  return key.replaceAll('.', '_').replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/** `en` → `values`, `ne` → `values-ne`, `en-GB` → `values-b+en+GB`. */
function androidResourceDir(locale: string): string {
  if (locale === 'en') return 'values';
  const [language, region] = locale.split('-');
  return region ? `values-b+${language}+${region}` : `values-${locale}`;
}

/** `TRAN / {platform}` → `TRAN / %1$s` (Android) or `%1$@` (iOS). */
function positionalTemplate(value: string, conversion: string): string {
  const order: string[] = [];
  for (const match of value.matchAll(/\{(\w+)\}/g)) {
    const name = match[1]!;
    if (!order.includes(name)) order.push(name);
  }
  let out = value;
  order.forEach((name, index) => {
    out = out.replaceAll(`{${name}}`, `%${index + 1}$${conversion}`);
  });
  return out;
}

function unescapeAndroid(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&')
    .replaceAll("\\'", "'")
    .replaceAll('\\"', '"')
    .replace(/^\\([@?])/, '$1');
}

function parseStringsXml(xml: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const match of xml.matchAll(/<string name="([^"]+)">([\s\S]*?)<\/string>/g)) {
    const [, name, value] = match;
    if (name === undefined || value === undefined) continue;
    entries.set(name, unescapeAndroid(value));
  }
  return entries;
}

function catalogOf(module: string): StringCatalog {
  return JSON.parse(
    readText(
      'apps',
      'ios',
      'Sources',
      'TranVotingDemo',
      'Generated',
      'Strings',
      `${pascal(module)}.xcstrings`
    )
  ) as StringCatalog;
}

function pascal(name: string): string {
  return name
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part !== '')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

describe('Android string resources mirror locales/', () => {
  it.each(LOCALES)('%s: strings_<module>.xml match the dictionaries exactly', (locale) => {
    const names = new Set<string>();
    for (const module of MODULES) {
      const xml = readText(
        'apps',
        'android',
        'app',
        'src',
        'main',
        'res',
        androidResourceDir(locale),
        `strings_${module}.xml`
      );
      for (const name of [...xml.matchAll(/<string name="([^"]+)"/g)].map((match) => match[1]!)) {
        expect(names.has(name), `Android resource names must be unique (${name})`).toBe(false);
        names.add(name);
      }

      const expected = new Map(
        [...moduleDictionary(locale, module)].map(([relative, value]) => [
          androidResourceName(fullKey(module, relative)),
          positionalTemplate(value, 's'),
        ])
      );
      expect(parseStringsXml(xml)).toEqual(expected);
    }
  });

  it('has no stale locale folders and no legacy strings.xml', () => {
    const dirs = readdirSync(androidResDir)
      .filter((name) => name.startsWith('values'))
      .sort();
    expect(dirs).toEqual(LOCALES.map(androidResourceDir).sort());

    for (const dir of dirs) {
      expect(readdirSync(path.join(androidResDir, dir))).not.toContain('strings.xml');
    }
  });

  it('exposes a typed TranStrings accessor per key with its dictionary key', () => {
    const kotlin = readText(
      'apps',
      'android',
      'app',
      'src',
      'main',
      'kotlin',
      'com',
      'tran',
      'voting',
      'generated',
      'TranStrings.kt'
    );
    for (const module of MODULES) {
      for (const [relative] of moduleDictionary('en', module)) {
        const key = fullKey(module, relative);
        expect(kotlin).toContain(
          `val ${memberName(relative)}: Int = R.string.${androidResourceName(key)} // ${key}`
        );
      }
    }
    expect(kotlin).toContain('import androidx.annotation.StringRes');
  });
});

describe('iOS String Catalogs mirror locales/', () => {
  it.each(MODULES)('%s.xcstrings matches the dictionaries for every locale', (module) => {
    const catalog = catalogOf(module);
    expect(catalog.sourceLanguage).toBe('en');

    const english = moduleDictionary('en', module);
    expect(Object.keys(catalog.strings).sort()).toEqual(
      [...english.keys()].map((relative) => fullKey(module, relative)).sort()
    );

    for (const [relative, value] of english) {
      const entry = catalog.strings[fullKey(module, relative)]!;
      expect(Object.keys(entry.localizations).sort()).toEqual([...LOCALES].sort());
      for (const locale of LOCALES) {
        const localization = entry.localizations[locale]!;
        expect(localization.stringUnit.state, `${locale}:${relative}`).toBe('translated');
        expect(localization.stringUnit.value, `${locale}:${relative}`).toBe(
          positionalTemplate(moduleDictionary(locale, module).get(relative)!, '@')
        );
      }
    }
  });

  it('generates only the module catalogs (no Localizable.xcstrings)', () => {
    expect(readdirSync(iosStringsDir).sort()).toEqual(
      MODULES.map((module) => `${pascal(module)}.xcstrings`).sort()
    );
    expect(existsSync(path.join(iosGeneratedDir, 'Localizable.xcstrings'))).toBe(false);
  });

  it('exposes a typed L10n accessor per key, bound to its module table', () => {
    const swift = readText('apps', 'ios', 'Sources', 'TranVotingDemo', 'Generated', 'L10n.swift');
    for (const module of MODULES) {
      const table = pascal(module);
      for (const [relative] of moduleDictionary('en', module)) {
        const key = fullKey(module, relative);
        expect(swift).toContain(`String(localized: "${key}", table: "${table}")`);
        const member = memberName(relative);
        expect(
          swift.includes(`static var ${member}: String`) ||
            swift.includes(`static func ${member}(`),
          `${table}.${member} accessor is missing`
        ).toBe(true);
      }
    }
  });
});

describe('iOS project locales follow locales/', () => {
  it('keeps knownRegions in sync with the locale directories', () => {
    const project = readText('apps', 'ios', 'project.yml');
    const known = /knownRegions:\n((?:\s+- \w+\n)+)/.exec(project)?.[1];
    const regions = known
      ?.trim()
      .split('\n')
      .map((line) => line.trim().replace(/^- /, ''))
      .filter((region) => region !== 'Base')
      .sort();
    expect(regions, 'update apps/ios/project.yml knownRegions').toEqual(LOCALES);
    expect(project).toContain('developmentLanguage: en');
  });

  it('ships Android generated artifacts in the expected package folder', () => {
    expect(readdirSync(androidGeneratedDir, { recursive: true })).toContain('TranStrings.kt');
  });
});
