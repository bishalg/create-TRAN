import { describe, expect, it } from 'vitest';
import { locales, t } from '../src/i18n.js';

function keysOf(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    keysOf(v, prefix ? `${prefix}.${k}` : k)
  );
}

describe('i18n dictionaries', () => {
  const reference = keysOf(locales.en).sort();

  it.each(['ne', 'hi'] as const)('%s has exactly the same keys as en', (locale) => {
    expect(keysOf(locales[locale]).sort()).toEqual(reference);
  });

  it.each(['en', 'ne', 'hi'] as const)('%s has no empty strings', (locale) => {
    for (const key of keysOf(locales[locale])) {
      expect(t(key, locale).trim(), `${locale}:${key}`).not.toBe('');
      expect(t(key, locale), `${locale}:${key} missing`).not.toBe(key);
    }
  });

  it('returns the key for a path that resolves to a namespace, not a string', () => {
    expect(t('app', 'en')).toBe('app');
  });
});

describe('t() fallbacks', () => {
  it('falls back to English for an unsupported locale', () => {
    expect(t('app.title', 'xx' as never)).toBe('Voting Eligibility');
  });

  it('defaults to English when no locale is passed', () => {
    expect(t('app.title')).toBe('Voting Eligibility');
  });
});
