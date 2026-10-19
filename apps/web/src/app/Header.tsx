import { type SupportedLocale, type ThemeMode, t } from '@tran/core';
import { TranButton } from '../shared/ui/TranButton.js';
import { TranText } from '../shared/ui/TranText.js';
import { MoonIcon, SunIcon } from '../shared/ui/icons.js';

const LOCALES: SupportedLocale[] = ['en', 'ne', 'hi'];

export interface HeaderProps {
  locale: SupportedLocale;
  onLocaleChange: (locale: SupportedLocale) => void;
  theme: ThemeMode;
  onThemeToggle: () => void;
  currentRole?: import('@tran/core').UserRole | null;
  onSignOut?: () => void;
}

export function Header({
  locale,
  onLocaleChange,
  theme,
  onThemeToggle,
  currentRole,
  onSignOut,
}: HeaderProps) {
  return (
    <header className="header">
      <TranText variant="body" as="span" className="brand">
        <div className="brand-mark" aria-hidden="true">
          T
        </div>
        <TranText variant="body" as="div" className="brand-name">
          TRAN
        </TranText>
      </TranText>

      <div className="header-actions">
        <div className="segmented" role="group" aria-label={t('app.languageLabel', locale)}>
          {LOCALES.map((code) => (
            <TranButton
              key={code}
              type="button"
              variant="secondary"
              size="md"
              className="segmented-item"
              aria-pressed={code === locale}
              onClick={() => onLocaleChange(code)}
            >
              {code.toUpperCase()}
            </TranButton>
          ))}
        </div>
        <TranButton
          type="button"
          variant="secondary"
          size="md"
          className="icon-button"
          aria-label={t(theme === 'dark' ? 'app.themeToLight' : 'app.themeToDark', locale)}
          onClick={onThemeToggle}
        >
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </TranButton>

        {currentRole && (
          <TranText variant="caption" as="span" className="role-badge" data-testid="role-badge">
            {currentRole === 'citizen_voter' ? 'Citizen Voter' : 'Election Auditor'}
          </TranText>
        )}

        {onSignOut && (
          <TranButton
            type="button"
            variant="secondary"
            size="md"
            className="sign-out-button"
            data-testid="sign-out-button"
            onClick={onSignOut}
            aria-label="Sign out"
          >
            Sign out
          </TranButton>
        )}
      </div>
    </header>
  );
}
