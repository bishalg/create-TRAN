import { type SupportedLocale, type ThemeMode, t } from '@tran/core';
import { MoonIcon, SunIcon } from './icons.js';

const LOCALES: SupportedLocale[] = ['en', 'ne', 'hi'];

export interface HeaderProps {
  locale: SupportedLocale;
  onLocaleChange: (locale: SupportedLocale) => void;
  theme: ThemeMode;
  onThemeToggle: () => void;
}

export function Header({ locale, onLocaleChange, theme, onThemeToggle }: HeaderProps) {
  return (
    <header className="header">
      <span className="brand">
        <span className="brand-mark" aria-hidden="true">
          T
        </span>
        <span className="brand-name">TRAN</span>
      </span>

      <div className="header-actions">
        <div className="segmented" role="group" aria-label={t('app.languageLabel', locale)}>
          {LOCALES.map((code) => (
            <button
              key={code}
              type="button"
              aria-pressed={code === locale}
              onClick={() => onLocaleChange(code)}
            >
              {code.toUpperCase()}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={t(theme === 'dark' ? 'app.themeToLight' : 'app.themeToDark', locale)}
          onClick={onThemeToggle}
        >
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>
    </header>
  );
}
