// Verifies: REQ-NAT-008
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(fileURLToPath(import.meta.url), '../../../../');

const LOCALES = ['en', 'ne', 'hi'] as const;

type Locale = (typeof LOCALES)[number];

const ANDROID_RES_DIRS: Record<Locale, string> = {
  en: 'values',
  ne: 'values-ne',
  hi: 'values-hi',
};

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

function flattenDictionary(value: unknown, prefix: string, out: Map<string, string>): void {
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      flattenDictionary(child, prefix === '' ? key : `${prefix}.${key}`, out);
    }
    return;
  }
  if (typeof value !== 'string') {
    throw new Error(`locale entry \`${prefix}\` is not a string`);
  }
  out.set(prefix, value);
}

function dictionaryOf(locale: Locale): Map<string, string> {
  const source = JSON.parse(
    readText('packages', 'core-ts', 'src', 'locales', `${locale}.json`)
  ) as unknown;
  const out = new Map<string, string>();
  flattenDictionary(source, '', out);
  return out;
}

/** `native.checkOffline` → `native_check_offline`, mirroring the codegen naming rule. */
function androidResourceName(key: string): string {
  return key.replaceAll('.', '_').replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function androidResourcesOf(locale: Locale): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of dictionaryOf(locale)) {
    out.set(androidResourceName(key), value);
  }
  return out;
}

function catalogOf(): StringCatalog {
  return JSON.parse(
    readText('apps', 'ios', 'Sources', 'TranVotingDemo', 'Generated', 'Localizable.xcstrings')
  ) as StringCatalog;
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

describe('native string resources mirror the shared dictionaries', () => {
  it.each(LOCALES)('Android strings.xml for %s matches the dictionary exactly', (locale) => {
    const xml = readText(
      'apps',
      'android',
      'app',
      'src',
      'main',
      'res',
      ANDROID_RES_DIRS[locale],
      'strings.xml'
    );

    const names = [...xml.matchAll(/<string name="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(names).size, 'Android resource names must be unique').toBe(names.length);

    expect(parseStringsXml(xml)).toEqual(androidResourcesOf(locale));
  });

  it.each(LOCALES)('iOS String Catalog for %s matches the dictionary exactly', (locale) => {
    const catalog = catalogOf();
    expect(catalog.sourceLanguage).toBe('en');

    const entries = new Map<string, string>();
    for (const [key, entry] of Object.entries(catalog.strings)) {
      const localization = entry.localizations[locale];
      expect(localization, `${locale}:${key} is missing`).toBeDefined();
      expect(localization.stringUnit.state, `${locale}:${key} must be translated`).toBe(
        'translated'
      );
      entries.set(key, localization.stringUnit.value);
    }

    expect(entries).toEqual(dictionaryOf(locale));
  });

  it('ships every locale for every key in the String Catalog', () => {
    for (const [key, entry] of Object.entries(catalogOf().strings)) {
      expect(Object.keys(entry.localizations).sort(), key).toEqual([...LOCALES].sort());
    }
  });
});
