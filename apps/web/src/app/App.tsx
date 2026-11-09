import { useEffect, useState } from 'react';
import {
  ScreenIds,
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
import { CrashBoundary } from '../shared/feedback/CrashBoundary.js';
import { FeedbackProvider, useFeedback } from '../shared/feedback/FeedbackProvider.js';
import { useGlobalErrors } from '../shared/feedback/useGlobalErrors.js';
import { TranText } from '../shared/ui/TranText.js';
import { Header } from './Header.js';
import { type ApiState, StatusFooter } from './StatusFooter.js';
import { usePreferences } from './usePreferences.js';

export interface AppProps {
  initialSession?: AuthSession;
  /** Tests inject an instant `sleep` so retries do not wait for real backoff. */
  retry?: UseTranApiOptions['retry'];
  /** Tests inject the indicator delay (`0` or huge) instead of using fake timers (REQ-LOAD-002). */
  loading?: { indicatorDelayMs: number };
}

export function App(props: AppProps = {}) {
  const preferences = usePreferences();
  // The boundary sits outside every provider so a broken provider still gets the crash screen
  // (REQ-ERR-011); its children keep one position, so nothing remounts (stable tree).
  return (
    <CrashBoundary locale={preferences.locale}>
      <FeedbackProvider locale={preferences.locale}>
        <Shell {...props} preferences={preferences} />
      </FeedbackProvider>
    </CrashBoundary>
  );
}

function Shell({
  initialSession,
  retry,
  loading,
  preferences: { locale, setLocale, theme, setTheme },
}: AppProps & { preferences: ReturnType<typeof usePreferences> }) {
  const feedback = useFeedback();
  useGlobalErrors(feedback);
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

  // An expired session asks first; "Sign in again" ends it (REQ-ERR-010).
  useEffect(
    () =>
      feedback.onErrorConfirmed('auth.session_expired', () =>
        setSession({ status: 'unauthenticated' })
      ),
    [feedback]
  );

  // Destructive: the catalogue makes this a confirmation dialog (REQ-ERR-007).
  const handleSignOut = async () => {
    if (await feedback.confirm('sign_out')) setSession({ status: 'unauthenticated' });
  };

  return (
    <div className="app">
      <a className="skip-link" href="#main" data-testid={ScreenIds.eligibility.skipLink}>
        {t('shell.skipToContent', locale)}
      </a>
      <Header
        locale={locale}
        onLocaleChange={setLocale}
        theme={theme}
        onThemeChange={destination === 'voter_dashboard' ? setTheme : undefined}
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

        {destination === 'voter_dashboard' && (
          <EligibilityPage api={api} locale={locale} indicatorDelayMs={loading?.indicatorDelayMs} />
        )}

        {destination === 'auditor_dashboard' && <AuditorPage locale={locale} />}
      </main>

      <StatusFooter
        state={apiState}
        version={api.info?.version}
        locale={locale}
        showStatus={destination === 'voter_dashboard'}
      />
    </div>
  );
}
