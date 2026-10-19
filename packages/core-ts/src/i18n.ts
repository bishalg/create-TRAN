import { type SupportedLocale, type TranStringKey } from './generated/keys.js';
import dictionaries from './generated/strings.json' with { type: 'json' };

export { TRAN_LOCALES } from './generated/keys.js';
export type { SupportedLocale, TranStringKey } from './generated/keys.js';

/** `locale → key → value`, generated from `locales/<locale>/*.json` by `pnpm i18n:sync`. */
export type TranslationDictionary = Record<string, string>;

export const locales: Record<SupportedLocale, TranslationDictionary> = dictionaries as Record<
  SupportedLocale,
  TranslationDictionary
>;

/**
 * Replaces `{name}` placeholders. A missing parameter leaves the literal `{name}` in
 * place, so a half-formatted string is never rendered as empty text.
 */
export function interpolate(
  template: string,
  params: Readonly<Record<string, string | number>> = {}
): string {
  return template.replace(/\{(\w+)\}/g, (literal, name: string) =>
    name in params ? String(params[name]) : literal
  );
}

/**
 * English is the base language and the fallback: `locale → en → key`. A missing or empty
 * translation never renders blank — the English value (or, at worst, the key itself) is
 * always shown.
 */
export function translate(
  dictionaries: Readonly<Record<string, TranslationDictionary>>,
  key: string,
  locale: string,
  params?: Readonly<Record<string, string | number>>
): string {
  const template = dictionaries[locale]?.[key] || dictionaries.en?.[key] || key;
  return params ? interpolate(template, params) : template;
}

/**
 * Looks up `key` for `locale`. Keys are typed (`TranStringKey`) so an invented key is a
 * compile error: add it to `locales/<locale>/<module>.json` and run `pnpm i18n:sync`.
 */
export function t(
  key: TranStringKey,
  locale: SupportedLocale = 'en',
  params?: Readonly<Record<string, string | number>>
): string {
  return translate(locales, key, locale, params);
}
