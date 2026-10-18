import React, { useEffect, useMemo, useState } from 'react';
import {
  type SupportedLocale,
  type ThemeMode,
  getThemeTokens,
  t,
} from '@tran/core';
import { GlassCard } from './components/ui/GlassCard.js';
import { GlassInput } from './components/ui/GlassInput.js';
import { SkeletonView } from './components/ui/SkeletonView.js';
import { Header } from './components/layout/Header.js';
import { useTranApi } from './hooks/useTranApi.js';

export const App: React.FC = () => {
  const [locale, setLocale] = useState<SupportedLocale>('en');
  const [themeMode, setThemeMode] = useState<ThemeMode>('dark');
  const [age, setAge] = useState('21');
  const [country, setCountry] = useState('US');

  const theme = useMemo(() => getThemeTokens(themeMode), [themeMode]);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
  }, [themeMode]);

  const {
    health,
    isLoading,
    isOffline,
    error,
    lastApiResult,
    lastOfflineResult,
    checkOffline,
    checkViaApi,
  } = useTranApi();

  const displayResult = lastApiResult ?? lastOfflineResult;
  const eligibilityColor = displayResult
    ? displayResult.eligible
      ? theme.palette.eligibility.canVote
      : theme.palette.eligibility.cannotVote
    : theme.palette.eligibility.neutral;

  const handleOffline = () => {
    const parsed = parseInt(age, 10);
    if (!Number.isNaN(parsed)) checkOffline(parsed, country);
  };

  const handleApi = async () => {
    const parsed = parseInt(age, 10);
    if (!Number.isNaN(parsed)) {
      await checkViaApi(parsed, { 'X-Debug-Country': country });
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background:
          themeMode === 'dark'
            ? 'linear-gradient(180deg, #0b0f19 0%, #111827 100%)'
            : 'linear-gradient(180deg, #f8fafc 0%, #e2e8f0 100%)',
        color: theme.palette.text.primary,
      }}
    >
      <Header
        currentLocale={locale}
        onLocaleChange={setLocale}
        breadcrumbs={[t('app.title', locale), 'Demo']}
      />

      <main style={{ maxWidth: '960px', margin: '0 auto', width: '100%', padding: '2rem 1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginBottom: '1rem' }}>
          {(['dark', 'light'] as ThemeMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setThemeMode(mode)}
              style={{
                padding: '0.35rem 0.75rem',
                borderRadius: theme.radii.pill,
                border: `1px solid ${theme.glass.border.standard}`,
                background: themeMode === mode ? theme.palette.primaryGlow : 'transparent',
                color: theme.palette.text.primary,
                cursor: 'pointer',
              }}
            >
              {mode === 'light' ? t('app.themeLight', locale) : t('app.themeDark', locale)}
            </button>
          ))}
        </div>

        <section style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '2.5rem', fontWeight: 800, margin: '0.25rem 0' }}>
            {t('app.title', locale)}
          </h1>
          <p style={{ color: theme.palette.text.secondary }}>{t('app.subtitle', locale)}</p>
        </section>

        {isOffline && (
          <div
            style={{
              padding: '0.75rem 1rem',
              borderRadius: theme.radii.md,
              backgroundColor: `${theme.palette.warning}22`,
              border: `1px solid ${theme.palette.warning}`,
              color: theme.palette.warning,
              marginBottom: '1.5rem',
              textAlign: 'center',
            }}
          >
            {t('app.offlineNotice', locale)}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.25rem' }}>
          <GlassCard variant="prominent" theme={theme}>
            <h2 style={{ marginTop: 0 }}>{t('app.checkOffline', locale)}</h2>
            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
              <GlassInput
                label={t('app.ageLabel', locale)}
                type="number"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                theme={theme}
              />
              <GlassInput
                label={t('app.countryLabel', locale)}
                value={country}
                onChange={(e) => setCountry(e.target.value.toUpperCase())}
                theme={theme}
              />
            </div>
            <button
              type="button"
              onClick={handleOffline}
              style={{
                width: '100%',
                padding: '0.85rem',
                borderRadius: theme.radii.md,
                border: 'none',
                background: theme.palette.primary,
                color: themeMode === 'dark' ? '#0f172a' : '#fff',
                fontWeight: 700,
                cursor: 'pointer',
                marginBottom: '0.75rem',
              }}
            >
              {t('app.checkOffline', locale)}
            </button>
            <button
              type="button"
              onClick={handleApi}
              style={{
                width: '100%',
                padding: '0.85rem',
                borderRadius: theme.radii.md,
                border: `1px solid ${theme.glass.border.standard}`,
                background: 'transparent',
                color: theme.palette.text.primary,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {t('app.checkButton', locale)}
            </button>

            {displayResult && (
              <div
                style={{
                  marginTop: '1.25rem',
                  padding: '1rem',
                  borderRadius: theme.radii.md,
                  border: `1px solid ${eligibilityColor}`,
                  backgroundColor: `${eligibilityColor}18`,
                }}
              >
                <div style={{ fontWeight: 700, color: eligibilityColor }}>
                  {displayResult.eligible
                    ? t('app.eligibleYes', locale)
                    : t('app.eligibleNo', locale)}
                </div>
                <p style={{ margin: '0.5rem 0 0', fontSize: '0.9rem' }}>{displayResult.reason}</p>
                {'country_code' in displayResult && (
                  <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: theme.palette.text.muted }}>
                    {displayResult.country_code} · min age {displayResult.minimum_age}
                    {lastApiResult ? ` · IP ${lastApiResult.client_ip}` : ''}
                  </p>
                )}
              </div>
            )}

            {error && (
              <p style={{ color: theme.palette.danger, fontSize: '0.85rem', marginTop: '0.75rem' }}>
                {error}
              </p>
            )}
          </GlassCard>

          <GlassCard variant="standard" theme={theme}>
            <h2 style={{ marginTop: 0 }}>{t('app.status', locale)}</h2>
            {isLoading ? (
              <SkeletonView count={3} height="28px" />
            ) : health ? (
              <div>
                <div style={{ color: theme.palette.success, fontWeight: 600, marginBottom: '0.75rem' }}>
                  ● {health.overall_status}
                </div>
                {health.components.map((comp) => (
                  <div
                    key={comp.name}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '0.85rem',
                      padding: '0.4rem 0',
                      color: theme.palette.text.secondary,
                    }}
                  >
                    <span>{comp.name}</span>
                    <span>v{comp.version}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ color: theme.palette.text.secondary }}>API standby</p>
            )}
          </GlassCard>
        </div>
      </main>
    </div>
  );
};
