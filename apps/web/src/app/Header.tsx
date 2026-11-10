import {
  ScreenIds,
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
  /** Shows the theme picker; the screen contract offers it on the voter dashboard only. */
  onThemeChange?: (theme: ThemeMode) => void;
  currentRole?: import('@tran/core').UserRole | null;
  /** May open a confirmation first, so it can be async. */
  onSignOut?: () => void | Promise<void>;
  /** Shown beside sign-out on every signed-in screen (REQ-ACC-004); asks first, so it can be async. */
  onDeleteAccount?: () => void | Promise<void>;
  /** A deletion is in flight: the control is busy and starts no other (REQ-ACC-006). */
  deletingAccount?: boolean;
}

export function Header({
  locale,
  onLocaleChange,
  theme,
  onThemeChange,
  currentRole,
  onSignOut,
  onDeleteAccount,
  deletingAccount = false,
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
        <div
          className="segmented"
          role="group"
          aria-label={t('shell.language.label', locale)}
          data-testid={ScreenIds.eligibility.languagePicker}
        >
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
        {onThemeChange && (
          <div
            className="segmented"
            role="group"
            aria-label={t('shell.theme.label', locale)}
            data-testid={ScreenIds.eligibility.themePicker}
          >
            {/* `value` names the option, so a scenario's `select` finds it in any language. */}
            {themeNames.map((mode) => (
              <TranButton
                key={mode}
                type="button"
                value={mode}
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
        )}

        {currentRole && (
          <TranText
            variant="caption"
            as="span"
            className="role-badge"
            data-testid={ScreenIds.eligibility.roleBadge}
          >
            {/* A badge is named by what it shows: "Role: Citizen Voter" (screen contract label). */}
            <TranText variant="caption" as="span" className="sr-only">
              {`${t('common.role.label', locale)}: `}
            </TranText>
            <TranText variant="caption" as="span">
              {t(
                currentRole === 'citizen_voter'
                  ? 'common.role.citizenVoter'
                  : 'common.role.electionAuditor',
                locale
              )}
            </TranText>
          </TranText>
        )}

        {onSignOut && (
          <TranButton
            type="button"
            variant="secondary"
            size="md"
            className="sign-out-button"
            data-testid={ScreenIds.eligibility.signOutButton}
            onClick={() => void onSignOut()}
            aria-label={t('common.signOut', locale)}
          >
            {t('common.signOut', locale)}
          </TranButton>
        )}

        {onDeleteAccount && (
          <TranButton
            type="button"
            variant="danger"
            size="md"
            className="delete-account-button"
            data-testid={ScreenIds.eligibility.deleteAccountButton}
            disabled={deletingAccount}
            aria-busy={deletingAccount}
            onClick={() => void onDeleteAccount()}
          >
            {t('common.deleteAccount', locale)}
          </TranButton>
        )}
      </div>
    </header>
  );
}
