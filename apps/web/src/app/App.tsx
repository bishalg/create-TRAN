import { useState } from 'react';
import {
  t,
  type AppDestination,
  type AuthSession,
  type UserRole,
  resolveDestination,
} from '@tran/core';
import { EligibilityPage } from '../features/eligibility/EligibilityPage.js';
import { AuthWelcomePage } from '../features/auth/AuthWelcomePage.js';
import { AuditorPage } from '../features/auditor/AuditorPage.js';
import { type UseTranApiOptions, useTranApi } from '../shared/api/useTranApi.js';
import { FeedbackProvider, useFeedback } from '../shared/feedback/FeedbackProvider.js';
import { TranText } from '../shared/ui/TranText.js';
import { Header } from './Header.js';
import { type ApiState, StatusFooter } from './StatusFooter.js';
import { usePreferences } from './usePreferences.js';

export interface AppProps {
  initialSession?: AuthSession;
  /** Tests inject an instant `sleep` so retries do not wait for real backoff. */
  retry?: UseTranApiOptions['retry'];
}

export function App(props: AppProps = {}) {
  const preferences = usePreferences();
  return (
    <FeedbackProvider locale={preferences.locale}>
      <Shell {...props} preferences={preferences} />
    </FeedbackProvider>
  );
}

function Shell({
  initialSession,
  retry,
  preferences: { locale, setLocale, theme, setTheme },
}: AppProps & { preferences: ReturnType<typeof usePreferences> }) {
  const feedback = useFeedback();
  const api = useTranApi({ feedback, retry });
  const apiState: ApiState = api.isLoading
    ? 'checking'
    : api.isOffline || !api.health
      ? 'offline'
      : 'online';

  const [session, setSession] = useState<AuthSession>(
    initialSession ?? {
      status: 'authenticated',
      userId: 'voter-001',
      role: 'citizen_voter',
    }
  );

  const destination: AppDestination = resolveDestination(session);
  const currentRole: UserRole | null = session.status === 'authenticated' ? session.role : null;

  const handleSelectRole = (role: UserRole) => {
    setSession({
      status: 'authenticated',
      userId: role === 'citizen_voter' ? 'voter-001' : 'auditor-001',
      role,
    });
  };

  // Destructive: the catalogue makes this a confirmation dialog (REQ-ERR-007).
  const handleSignOut = async () => {
    if (await feedback.confirm('sign_out')) setSession({ status: 'unauthenticated' });
  };

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        {t('shell.skipToContent', locale)}
      </a>
      <Header
        locale={locale}
        onLocaleChange={setLocale}
        theme={theme}
        onThemeChange={setTheme}
        currentRole={currentRole}
        onSignOut={currentRole ? handleSignOut : undefined}
      />

      <main id="main" className="shell" tabIndex={-1}>
        <section className="hero">
          <TranText variant="display" as="h1">
            {t('shell.title', locale)}
          </TranText>
          <TranText variant="muted">{t('shell.subtitle', locale)}</TranText>
        </section>

        {destination === 'auth_welcome' && (
          <AuthWelcomePage locale={locale} onSelectRole={handleSelectRole} />
        )}

        {destination === 'voter_dashboard' && <EligibilityPage api={api} locale={locale} />}

        {destination === 'auditor_dashboard' && (
          <AuditorPage locale={locale} onBackToVoter={() => handleSelectRole('citizen_voter')} />
        )}
      </main>

      <StatusFooter state={apiState} version={api.info?.version} locale={locale} />
    </div>
  );
}
