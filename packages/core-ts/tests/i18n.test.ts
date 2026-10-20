// Verifies: REQ-WEB-008 REQ-I18N-001 REQ-I18N-002 REQ-I18N-003 REQ-I18N-004
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  interpolate,
  locales,
  t,
  TRAN_LOCALES,
  translate,
  type TranslationDictionary,
} from '../src/i18n.js';

const root = path.resolve(fileURLToPath(import.meta.url), '../../../../');
const localesDir = path.join(root, 'locales');

/** The locale directories are the single source of truth: add/remove one directory. */
const LOCALE_IDS = readdirSync(localesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const MODULES = readdirSync(path.join(localesDir, 'en'))
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.replace(/\.json$/, ''))
  .sort();

/** `locales/<locale>/<module>.json` files flattened to `<module>.<path>` keys. */
function sourceDictionary(locale: string): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const module of MODULES) {
    const raw: unknown = JSON.parse(
      readFileSync(path.join(localesDir, locale, `${module}.json`), 'utf8')
    );
    entriesOf(raw, module, flat);
  }
  return flat;
}

function entriesOf(value: unknown, prefix: string, out: Record<string, string>): void {
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      entriesOf(child, `${prefix}.${key}`, out);
    }
    return;
  }
  if (typeof value !== 'string') throw new Error(`locale entry \`${prefix}\` is not a string`);
  out[prefix] = value;
}

function placeholdersOf(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!).sort();
}

describe('dictionaries in locales/', () => {
  const english = sourceDictionary('en');

  it('generates TRAN_LOCALES from the locale directories, English first', () => {
    expect([...TRAN_LOCALES].sort()).toEqual(LOCALE_IDS);
    expect(TRAN_LOCALES[0]).toBe('en');
  });

  it.each(LOCALE_IDS)('%s has exactly the same keys as en', (locale) => {
    expect(Object.keys(sourceDictionary(locale)).sort()).toEqual(Object.keys(english).sort());
  });

  it.each(LOCALE_IDS)('%s has no empty values', (locale) => {
    for (const [key, value] of Object.entries(sourceDictionary(locale))) {
      expect(value.trim(), `${locale}:${key}`).not.toBe('');
    }
  });

  it.each(LOCALE_IDS)('%s keeps the same placeholders as en', (locale) => {
    const dictionary = sourceDictionary(locale);
    for (const [key, value] of Object.entries(english)) {
      expect(placeholdersOf(dictionary[key]!), `${locale}:${key}`).toEqual(placeholdersOf(value));
    }
  });

  it('defines every English value in exactly one module', () => {
    const home = new Map<string, string>();
    for (const module of MODULES) {
      const raw: unknown = JSON.parse(
        readFileSync(path.join(localesDir, 'en', `${module}.json`), 'utf8')
      );
      const entries: Record<string, string> = {};
      entriesOf(raw, module, entries);
      for (const [key, value] of Object.entries(entries)) {
        const existing = home.get(value);
        expect(
          existing,
          `\`${value}\` is in \`${existing}\` and \`${key}\`; share it via common`
        ).toBeUndefined();
        home.set(value, key);
      }
    }
  });

  it.each(LOCALE_IDS)('generated strings.json matches %s exactly', (locale) => {
    expect(locales[locale as (typeof TRAN_LOCALES)[number]]).toEqual(sourceDictionary(locale));
  });
});

describe('t()', () => {
  it('resolves a typed key for each locale', () => {
    expect(t('shell.title', 'en')).toBe('Voting Eligibility');
    expect(t('shell.title', 'ne')).toBe('मतदान योग्यता');
    expect(t('shell.title', 'hi')).toBe('मतदान पात्रता');
  });

  it('defaults to English, the base language', () => {
    expect(t('common.brand')).toBe('TRAN');
  });

  it('fills named placeholders', () => {
    expect(t('auditor.years', 'en', { years: 18 })).toBe('18 years');
  });
});

describe('translate()', () => {
  const english: TranslationDictionary = { 'greeting.hello': 'Hello {name}!' };

  it('shows the key when there is no English dictionary at all', () => {
    expect(translate({ ne: {} }, 'greeting.hello', 'ne')).toBe('greeting.hello');
  });

  it('falls back from a missing translation to English', () => {
    expect(translate({ en: english, ne: {} }, 'greeting.hello', 'ne')).toBe('Hello {name}!');
  });

  it('falls back from an unsupported locale to English', () => {
    expect(translate({ en: english }, 'greeting.hello', 'xx')).toBe('Hello {name}!');
  });

  it('treats an empty translation as missing', () => {
    expect(translate({ en: english, ne: { 'greeting.hello': '' } }, 'greeting.hello', 'ne')).toBe(
      'Hello {name}!'
    );
  });

  it('returns the key itself when no dictionary has the value', () => {
    expect(translate({ en: {}, ne: {} }, 'greeting.missing', 'ne')).toBe('greeting.missing');
  });

  it('interpolates parameters when provided', () => {
    expect(translate({ en: english }, 'greeting.hello', 'en', { name: 'Ada' })).toBe('Hello Ada!');
  });
});

describe('interpolate()', () => {
  it('substitutes every named placeholder, stringifying values', () => {
    expect(interpolate('{a} + {b} = {sum}', { a: 1, b: 2, sum: 3 })).toBe('1 + 2 = 3');
    expect(interpolate('{word} {word}', { word: 'again' })).toBe('again again');
  });

  it('keeps the literal placeholder when a parameter is missing', () => {
    expect(interpolate('Hi {name}')).toBe('Hi {name}');
    expect(interpolate('Hi {name}', { other: 'x' })).toBe('Hi {name}');
  });
});
