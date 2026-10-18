import React, { useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  getThemeTokens,
  parseAgeInput,
  t,
  type SupportedLocale,
  type ThemeMode,
} from '@tran/core';
import { GlassCard } from '../components/GlassCard.js';
import { GlassInput } from '../components/GlassInput.js';
import { SkeletonView } from '../components/SkeletonView.js';
import { useTranApi } from '../hooks/useTranApi.js';

function EligibilityBlock({
  result,
  theme,
  locale,
  extra,
}: {
  result: { eligible: boolean; reason: string };
  theme: ReturnType<typeof getThemeTokens>;
  locale: SupportedLocale;
  extra?: string;
}) {
  const color = result.eligible
    ? theme.palette.eligibility.canVote
    : theme.palette.eligibility.cannotVote;

  return (
    <View style={[styles.resultBox, { borderColor: color, backgroundColor: `${color}22` }]}>
      <Text style={{ color, fontWeight: '700' }}>
        {result.eligible ? t('app.eligibleYes', locale) : t('app.eligibleNo', locale)}
      </Text>
      <Text style={{ color: theme.palette.text.secondary, marginTop: 4 }}>{result.reason}</Text>
      {extra ? (
        <Text style={{ color: theme.palette.text.muted, marginTop: 4, fontSize: 12 }}>{extra}</Text>
      ) : null}
    </View>
  );
}

export const HomeScreen: React.FC = () => {
  const [locale, setLocale] = useState<SupportedLocale>('en');
  const [themeMode, setThemeMode] = useState<ThemeMode>('dark');
  const [age, setAge] = useState('20');
  const [country, setCountry] = useState('NP');
  const [apiCountry, setApiCountry] = useState('NP');

  const theme = getThemeTokens(themeMode);
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

  const [inputError, setInputError] = useState<string | null>(null);

  const readAge = (): number | null => {
    const parsed = parseAgeInput(age);
    setInputError(parsed === null ? t('app.ageInvalid', locale) : null);
    return parsed;
  };

  const handleOffline = () => {
    const parsed = readAge();
    if (parsed !== null) checkOffline(parsed, country);
  };

  const handleApi = async () => {
    const parsed = readAge();
    if (parsed !== null) await checkViaApi(parsed, { 'X-Debug-Country': apiCountry });
  };

  // Unreachable servers are announced by the offline notice; everything else is actionable.
  const alertMessage = inputError ?? (isOffline ? null : error);

  return (
    <SafeAreaView
      style={[styles.safeArea, { backgroundColor: themeMode === 'dark' ? '#0b0f19' : '#f1f5f9' }]}
    >
      <StatusBar barStyle={themeMode === 'dark' ? 'light-content' : 'dark-content'} />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <Text style={[styles.breadcrumb, { color: theme.palette.primary }]}>TRAN / Mobile</Text>
          <View style={styles.localeRow}>
            {(['en', 'ne', 'hi'] as SupportedLocale[]).map((loc) => (
              <TouchableOpacity
                key={loc}
                onPress={() => setLocale(loc)}
                style={[
                  styles.localeBtn,
                  locale === loc && { borderColor: theme.palette.primary },
                ]}
              >
                <Text
                  style={{
                    color: locale === loc ? theme.palette.primary : theme.palette.text.secondary,
                    fontSize: 12,
                    fontWeight: locale === loc ? '600' : '400',
                  }}
                >
                  {loc.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.themeRow}>
          {(['dark', 'light'] as ThemeMode[]).map((mode) => (
            <TouchableOpacity key={mode} onPress={() => setThemeMode(mode)}>
              <Text
                style={{
                  color: themeMode === mode ? theme.palette.primary : theme.palette.text.secondary,
                }}
              >
                {mode === 'light' ? t('app.themeLight', locale) : t('app.themeDark', locale)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.title, { color: theme.palette.text.primary }]}>{t('app.title', locale)}</Text>
        <Text style={[styles.subtitle, { color: theme.palette.text.secondary }]}>
          {t('app.subtitle', locale)}
        </Text>

        {isOffline && (
          <Text style={[styles.offlineBanner, { color: theme.palette.warning }]}>
            {t('app.offlineNotice', locale)}
          </Text>
        )}

        <GlassCard variant="prominent" style={styles.sectionCard}>
          <Text style={[styles.sectionTitle, { color: theme.palette.text.primary }]}>
            {t('app.sectionOffline', locale)}
          </Text>
          <View style={styles.inputRow}>
            <View style={{ flex: 1 }}>
              <GlassInput
                label={t('app.ageLabel', locale)}
                value={age}
                onChangeText={setAge}
                keyboardType="numeric"
              />
            </View>
            <View style={{ width: 12 }} />
            <View style={{ flex: 1 }}>
              <GlassInput
                label={t('app.countryLabel', locale)}
                value={country}
                onChangeText={(v) => setCountry(v.toUpperCase())}
              />
            </View>
          </View>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: theme.palette.primary }]}
            onPress={handleOffline}
          >
            <Text style={styles.actionBtnText}>{t('app.checkOffline', locale)}</Text>
          </TouchableOpacity>
          {lastOfflineResult && (
            <EligibilityBlock result={lastOfflineResult} theme={theme} locale={locale} />
          )}
        </GlassCard>

        <GlassCard variant="standard" style={styles.sectionCard}>
          <Text style={[styles.sectionTitle, { color: theme.palette.text.primary }]}>
            {t('app.sectionApi', locale)}
          </Text>
          <Text style={{ color: theme.palette.text.secondary, fontSize: 13, marginBottom: 8 }}>
            {t('app.apiCountryHint', locale)}
          </Text>
          <View style={styles.inputRow}>
            <View style={{ flex: 1 }}>
              <GlassInput
                label={t('app.ageLabel', locale)}
                value={age}
                onChangeText={setAge}
                keyboardType="numeric"
              />
            </View>
            <View style={{ width: 12 }} />
            <View style={{ flex: 1 }}>
              <GlassInput
                label={t('app.countryApiLabel', locale)}
                value={apiCountry}
                onChangeText={(v) => setApiCountry(v.toUpperCase())}
              />
            </View>
          </View>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: theme.palette.accent }]}
            onPress={handleApi}
          >
            <Text style={styles.actionBtnText}>{t('app.checkButton', locale)}</Text>
          </TouchableOpacity>
          {lastApiResult && (
            <EligibilityBlock
              result={lastApiResult}
              theme={theme}
              locale={locale}
              extra={`${lastApiResult.country_code} · min ${lastApiResult.minimum_age} · IP ${lastApiResult.client_ip}`}
            />
          )}
          {alertMessage ? (
            <Text accessibilityRole="alert" style={{ color: theme.palette.danger, marginTop: 8 }}>
              {alertMessage}
            </Text>
          ) : null}
        </GlassCard>

        <GlassCard variant="subtle" style={styles.sectionCard}>
          <Text style={[styles.sectionTitle, { color: theme.palette.text.primary }]}>
            {t('app.status', locale)}
          </Text>
          {isLoading ? (
            <SkeletonView count={3} height={24} />
          ) : health ? (
            <Text style={{ color: theme.palette.success }}>● {health.overall_status}</Text>
          ) : (
            <Text style={{ color: theme.palette.text.secondary }}>API standby</Text>
          )}
        </GlassCard>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  container: { padding: 20 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  themeRow: { flexDirection: 'row', gap: 16, marginBottom: 12 },
  breadcrumb: { fontWeight: '600', fontSize: 14 },
  localeRow: { flexDirection: 'row', gap: 6 },
  localeBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  title: { fontSize: 26, fontWeight: '800', marginBottom: 6 },
  subtitle: { fontSize: 14, marginBottom: 20 },
  offlineBanner: { fontSize: 13, marginBottom: 12 },
  sectionCard: { marginBottom: 20 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 12 },
  inputRow: { flexDirection: 'row', marginBottom: 12 },
  actionBtn: { paddingVertical: 12, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  actionBtnText: { color: '#0b0f19', fontWeight: '700', fontSize: 15 },
  resultBox: { marginTop: 14, padding: 12, borderRadius: 10, borderWidth: 1 },
});
