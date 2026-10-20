import {
  type SupportedLocale,
  type ThemeMode,
  type TranStringKey,
  TRAN_LOCALES,
  t,
  themeNames,
} from '@tran/core';
import { TranButton } from '../shared/ui/TranButton.js';
import { TranText } from '../shared/ui/TranText.js';

const THEME_KEYS: Record<ThemeMode, TranStringKey> = {
  light: 'shell.theme.light',
  dark: 'shell.theme.dark',
  black: 'shell.theme.black',
  sepia: 'shell.theme.sepia',
};

export interface HeaderProps {
  locale: SupportedLocale;
  onLocaleChange: (locale: SupportedLocale) => void;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  currentRole?: import('@tran/core').UserRole | null;
  /** May open a confirmation first, so it can be async. */
  onSignOut?: () => void | Promise<void>;
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
          {t('common.brand', locale)}
        </TranText>
      </TranText>

      <div className="header-actions">
        <div className="segmented" role="group" aria-label={t('shell.language.label', locale)}>
          {TRAN_LOCALES.map((code) => (
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
        <div className="segmented" role="group" aria-label={t('shell.theme.label', locale)}>
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
              {t(THEME_KEYS[mode], locale)}
            </TranButton>
          ))}
        </div>

        {currentRole && (
          <TranText variant="caption" as="span" className="role-badge" data-testid="role-badge">
            {t(
              currentRole === 'citizen_voter'
                ? 'common.role.citizenVoter'
                : 'common.role.electionAuditor',
              locale
            )}
          </TranText>
        )}

        {onSignOut && (
          <TranButton
            type="button"
            variant="secondary"
            size="md"
            className="sign-out-button"
            data-testid="sign-out-button"
            onClick={() => void onSignOut()}
            aria-label={t('common.signOut', locale)}
          >
            {t('common.signOut', locale)}
          </TranButton>
        )}
      </div>
    </header>
  );
}
