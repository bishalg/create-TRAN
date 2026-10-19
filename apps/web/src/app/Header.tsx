import { type SupportedLocale, type ThemeMode, t, themeNames } from '@tran/core';
import { TranButton } from '../shared/ui/TranButton.js';
import { TranText } from '../shared/ui/TranText.js';

const LOCALES: SupportedLocale[] = ['en', 'ne', 'hi'];

export interface HeaderProps {
  locale: SupportedLocale;
  onLocaleChange: (locale: SupportedLocale) => void;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  currentRole?: import('@tran/core').UserRole | null;
  onSignOut?: () => void;
}

export function Header({
  locale,
  onLocaleChange,
  theme,
  onThemeChange,
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
        <div className="segmented" role="group" aria-label={t('app.themeLabel', locale)}>
          {themeNames.map((mode) => (
            <TranButton
              key={mode}
              type="button"
              variant="secondary"
              size="md"
              className="segmented-item"
              aria-pressed={mode === theme}
              onClick={() => onThemeChange(mode)}
            >
              {t(`app.themes.${mode}`, locale)}
            </TranButton>
          ))}
        </div>

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
