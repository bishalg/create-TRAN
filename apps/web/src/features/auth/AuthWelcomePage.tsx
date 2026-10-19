import { type SupportedLocale, type UserRole, t } from '@tran/core';
import { TranButton } from '../../shared/ui/TranButton.js';
import { TranStack } from '../../shared/ui/TranStack.js';
import { TranText } from '../../shared/ui/TranText.js';

export interface AuthWelcomePageProps {
  locale: SupportedLocale;
  onSelectRole: (role: UserRole) => void;
}

export function AuthWelcomePage({ locale, onSelectRole }: AuthWelcomePageProps) {
  return (
    <div className="auth-welcome card">
      <TranText variant="title" as="h2">
        {t('auth.welcome.title', locale)}
      </TranText>
      <TranText variant="body">{t('auth.welcome.subtitle', locale)}</TranText>
      <TranStack className="auth-branches" gap="md">
        <TranButton type="button" onClick={() => onSelectRole('citizen_voter')}>
          {t('auth.continueAsVoter', locale)}
        </TranButton>
        <TranButton type="button" onClick={() => onSelectRole('election_auditor')}>
          {t('auth.continueAsAuditor', locale)}
        </TranButton>
      </TranStack>
    </div>
  );
}
