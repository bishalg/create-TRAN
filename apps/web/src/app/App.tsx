import { useCallback, useEffect, useState } from 'react';
import {
  ScreenIds,
  t,
  type AppDestination,
  type AuthSession,
  type StandingSignal,
  type UserRole,
  resolveDestination,
} from '@tran/core';
import { EligibilityPage } from '../features/eligibility/EligibilityPage.js';
import { AuthWelcomePage } from '../features/auth/AuthWelcomePage.js';
import { AuditorPage } from '../features/auditor/AuditorPage.js';
import { useSession } from '../shared/api/useSession.js';
import { type UseTranApiOptions, useTranApi } from '../shared/api/useTranApi.js';
import { CrashBoundary } from '../shared/feedback/CrashBoundary.js';
import { FeedbackProvider, useFeedback } from '../shared/feedback/FeedbackProvider.js';
import { UpdateRequired } from '../shared/feedback/UpdateRequired.js';
import { useGlobalErrors } from '../shared/feedback/useGlobalErrors.js';
import { useUpdatePrompt } from '../shared/feedback/useUpdatePrompt.js';
import { TranText } from '../shared/ui/TranText.js';
import { Header } from './Header.js';
import { type ApiState, StatusFooter } from './StatusFooter.js';
import { usePreferences } from './usePreferences.js';

export interface AppProps {
  /** Starts on this session instead of restoring one from the API (tests and previews). */
  initialSession?: AuthSession;
  /** Tests inject an instant `sleep` so retries do not wait for real backoff. */
  retry?: UseTranApiOptions['retry'];
  /** Tests inject the indicator delay (`0` or huge) instead of using fake timers (REQ-LOAD-002). */
  loading?: { indicatorDelayMs: number };
  /** Tests inject this; "Update" reloads the page into the newest build (REQ-VER-009, 010). */
  reload?: () => void;
}

const reloadPage = () => window.location.reload();

/** Whether `next` says something `previous` did not. */
const changed = (previous: StandingSignal | null, next: StandingSignal) =>
  previous?.standing !== next.standing || previous.recommendedVersion !== next.recommendedVersion;

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
  reload = reloadPage,
  preferences: { locale, setLocale, theme, setTheme },
}: AppProps & { preferences: ReturnType<typeof usePreferences> }) {
  const feedback = useFeedback();
  useGlobalErrors(feedback);
  // What the last answers said about this version. Once blocked, a later nudge never lifts the
  // update screen (REQ-VER-009).
  const [standing, setStanding] = useState<StandingSignal | null>(null);
  const onStanding = useCallback(
    (signal: StandingSignal) =>
      setStanding((previous) =>
        previous?.standing === 'upgrade_required' || !changed(previous, signal) ? previous : signal
      ),
    []
  );
  useUpdatePrompt(standing, feedback, reload);
  const api = useTranApi({ feedback, retry, onStanding });
  const apiState: ApiState = api.isLoading
    ? 'checking'
    : api.isOffline || !api.health
      ? 'offline'
      : 'online';

  const { session, signIn, signOut, deleteAccount } = useSession({
    feedback,
    initialSession,
    onStanding,
  });

  // Until the boot refresh answers, the Splash: nothing to choose yet (REQ-NAV-001, REQ-SEC-021).
  const destination: AppDestination = session ? resolveDestination(session) : 'splash';
  const currentRole: UserRole | null = session?.status === 'authenticated' ? session.role : null;

  // An expired session asks first; "Sign in again" ends it (REQ-ERR-010).
  useEffect(() => feedback.onErrorConfirmed('auth.session_expired', signOut), [feedback, signOut]);

  // Destructive: the catalogue makes this a confirmation dialog (REQ-ERR-007).
  const handleSignOut = async () => {
    if (await feedback.confirm('sign_out')) signOut();
  };

  // Permanent, so it asks with its own copy; a failure is reported like any other call (REQ-ACC-006).
  // While it is in flight the control is busy: a second deletion could only answer 401.
  const [deleting, setDeleting] = useState(false);
  const handleDeleteAccount = async () => {
    if (!(await feedback.confirm('delete_account'))) return;
    setDeleting(true);
    const failure = await deleteAccount();
    setDeleting(false);
    if (failure) api.reportFailure(failure);
  };

  // The catalogue's `screen` for `client.upgrade_required`: it replaces everything (REQ-VER-009).
  if (standing?.standing === 'upgrade_required') {
    return <UpdateRequired locale={locale} onUpdate={reload} />;
  }

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
        onDeleteAccount={currentRole ? handleDeleteAccount : undefined}
        deletingAccount={deleting}
      />

      <main id="main" className="shell" tabIndex={-1}>
        <section className="hero">
          <TranText variant="display" as="h1">
            {t('shell.title', locale)}
          </TranText>
          <TranText variant="muted">{t('shell.subtitle', locale)}</TranText>
        </section>

        {destination === 'auth_welcome' && (
          <AuthWelcomePage locale={locale} onSelectRole={signIn} />
        )}

        {destination === 'voter_dashboard' && (
          <EligibilityPage api={api} locale={locale} indicatorDelayMs={loading?.indicatorDelayMs} />
        )}

        {destination === 'auditor_dashboard' && (
          <AuditorPage locale={locale} notice={api.banner?.spec.messageKey} />
        )}
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
