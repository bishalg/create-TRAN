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
import { useTranApi } from '../shared/api/useTranApi.js';
import { TranText } from '../shared/ui/TranText.js';
import { Header } from './Header.js';
import { type ApiState, StatusFooter } from './StatusFooter.js';
import { usePreferences } from './usePreferences.js';

export interface AppProps {
  initialSession?: AuthSession;
}

export function App({ initialSession }: AppProps = {}) {
  const { locale, setLocale, theme, setTheme } = usePreferences();
  const api = useTranApi();
  const apiState: ApiState = api.isLoading ? 'checking' : api.isOffline ? 'offline' : 'online';

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

  const handleSignOut = () => {
    setSession({ status: 'unauthenticated' });
  };

  return (
    <div className="app">
      <Header
        locale={locale}
        onLocaleChange={setLocale}
        theme={theme}
        onThemeChange={setTheme}
        currentRole={currentRole}
        onSignOut={currentRole ? handleSignOut : undefined}
      />

      <main className="shell">
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
