import { t } from '@tran/core';
import { EligibilityPage } from '../features/eligibility/EligibilityPage.js';
import { useTranApi } from '../shared/api/useTranApi.js';
import { Header } from './Header.js';
import { type ApiState, StatusFooter } from './StatusFooter.js';
import { usePreferences } from './usePreferences.js';

export function App() {
  const { locale, setLocale, theme, toggleTheme } = usePreferences();
  const api = useTranApi();
  const apiState: ApiState = api.isLoading ? 'checking' : api.isOffline ? 'offline' : 'online';

  return (
    <div className="app">
      <Header
        locale={locale}
        onLocaleChange={setLocale}
        theme={theme}
        onThemeToggle={toggleTheme}
      />

      <main className="shell">
        <section className="hero">
          <h1>{t('app.title', locale)}</h1>
          <p>{t('app.subtitle2', locale)}</p>
        </section>

        <EligibilityPage api={api} locale={locale} />
      </main>

      <StatusFooter state={apiState} version={api.info?.version} locale={locale} />
    </div>
  );
}
