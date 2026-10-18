import en from './locales/en.json' with { type: 'json' };
import hi from './locales/hi.json' with { type: 'json' };
import ne from './locales/ne.json' with { type: 'json' };

export type SupportedLocale = 'en' | 'ne' | 'hi';

export const locales = { en, ne, hi } as const;

export type TranslationDictionary = typeof en;

export function t(key: string, locale: SupportedLocale = 'en'): string {
  const dict = locales[locale] || locales.en;
  const parts = key.split('.');

  let current: unknown = dict;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return key;
    }
  }

  return typeof current === 'string' ? current : key;
}
