import { type FormEvent, useEffect, useState } from 'react';
import { type SupportedLocale, type ThemeMode, parseAgeInput, t } from '@tran/core';
import { Field } from './components/Field.js';
import { Header } from './components/Header.js';
import { type CheckMode, ModeSwitch } from './components/ModeSwitch.js';
import { type EligibilityView, ResultCard } from './components/ResultCard.js';
import { type ApiState, StatusFooter } from './components/StatusFooter.js';
import { useTranApi } from './hooks/useTranApi.js';
import { initialTheme } from './lib/theme.js';

export function App() {
  const [locale, setLocale] = useState<SupportedLocale>('en');
  const [theme, setTheme] = useState<ThemeMode>(initialTheme);
  const [mode, setMode] = useState<CheckMode>('device');
  const [age, setAge] = useState('21');
  const [country, setCountry] = useState('US');
  const [inputError, setInputError] = useState<string | null>(null);

  const api = useTranApi();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const parsedAge = parseAgeInput(age);
    setInputError(parsedAge === null ? t('app.ageInvalid', locale) : null);
    if (parsedAge === null) return;

    if (mode === 'device') api.checkOffline(parsedAge, country);
    else await api.checkViaApi(parsedAge, { 'X-Debug-Country': country });
  };

  const result = toView(mode, api.lastOfflineResult, api.lastApiResult);
  // An unreachable server is explained by the notice; every other error is actionable.
  const alertMessage = inputError ?? (api.isOffline ? null : api.error);
  const apiState: ApiState = api.isLoading ? 'checking' : api.isOffline ? 'offline' : 'online';

  return (
    <div className="app">
      <Header
        locale={locale}
        onLocaleChange={setLocale}
        theme={theme}
        onThemeToggle={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      />

      <main className="shell">
        <section className="hero">
          <h1>{t('app.title', locale)}</h1>
          <p>{t('app.subtitle2', locale)}</p>
        </section>

        {api.isOffline && (
          <p className="notice" role="note">
            {t('app.offlineNotice', locale)}
          </p>
        )}

        <form
          className="card"
          aria-label={t('app.formLabel', locale)}
          onSubmit={onSubmit}
          noValidate
        >
          <ModeSwitch mode={mode} onChange={setMode} locale={locale} />

          <div className="fields">
            <Field
              label={t('app.ageField', locale)}
              value={age}
              onChange={(e) => setAge(e.target.value)}
              inputMode="numeric"
              autoComplete="off"
              placeholder={t('app.agePlaceholder', locale)}
              aria-invalid={inputError ? true : undefined}
            />
            <Field
              label={t('app.countryField', locale)}
              value={country}
              onChange={(e) => setCountry(e.target.value.toUpperCase())}
              maxLength={2}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder={t('app.countryPlaceholder', locale)}
              hint={t(mode === 'server' ? 'app.serverHint' : 'app.countryHint', locale)}
            />
          </div>

          <button
            type="submit"
            className="button"
            disabled={api.isChecking}
            aria-busy={api.isChecking}
          >
            {t(api.isChecking ? 'app.submitting' : 'app.submit', locale)}
          </button>
        </form>

        {alertMessage && (
          <p className="error" role="alert">
            {alertMessage}
          </p>
        )}

        <div className="result-slot" role="status">
          {result && <ResultCard result={result} locale={locale} />}
        </div>
      </main>

      <StatusFooter state={apiState} version={api.info?.version} locale={locale} />
    </div>
  );
}

function toView(
  mode: CheckMode,
  offline: ReturnType<typeof useTranApi>['lastOfflineResult'],
  server: ReturnType<typeof useTranApi>['lastApiResult']
): EligibilityView | null {
  if (mode === 'device') {
    return offline && { ...offline, source: 'device' };
  }
  return (
    server && {
      eligible: server.eligible,
      reason: server.reason,
      countryCode: server.country_code,
      minimumAge: server.minimum_age,
      source: 'server',
    }
  );
}
