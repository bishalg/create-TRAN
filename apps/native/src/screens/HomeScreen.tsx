import React, { useState, useEffect } from 'react';
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
  evaluateVoteEligibilityOffline,
  getThemeTokens,
  liquidGlassTokens,
  t,
  type SupportedLocale,
  type ThemeMode,
  TranApiClient,
  type TranHealthReport,
  type VoteEligibilityOutput,
} from '@tran/core';
import { GlassCard } from '../components/GlassCard.js';
import { GlassInput } from '../components/GlassInput.js';
import { SkeletonView } from '../components/SkeletonView.js';

export const HomeScreen: React.FC = () => {
  const [locale, setLocale] = useState<SupportedLocale>('en');
  const [themeMode, setThemeMode] = useState<ThemeMode>('dark');
  const [health, setHealth] = useState<TranHealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [age, setAge] = useState('20');
  const [country, setCountry] = useState('NP');
  const [apiResult, setApiResult] = useState<VoteEligibilityOutput | null>(null);

  const theme = getThemeTokens(themeMode);
  const client = new TranApiClient({ baseUrl: 'http://localhost:3001' });

  useEffect(() => {
    client
      .getHealth()
      .then((h) => setHealth(h))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  const offline = evaluateVoteEligibilityOffline({
    age: parseInt(age, 10) || 0,
    countryCode: country,
  });

  const display = apiResult ?? offline;
  const eligibilityColor = display.eligible
    ? theme.palette.eligibility.canVote
    : theme.palette.eligibility.cannotVote;

  const handleApi = async () => {
    const parsed = parseInt(age, 10);
    if (Number.isNaN(parsed)) return;
    try {
      const res = await client.checkVoteEligibility({ age: parsed });
      setApiResult(res);
    } catch {
      setApiResult(null);
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: themeMode === 'dark' ? '#0b0f19' : '#f1f5f9' }]}>
      <StatusBar barStyle={themeMode === 'dark' ? 'light-content' : 'dark-content'} />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerRow}>
          <Text style={[styles.breadcrumb, { color: theme.palette.primary }]}>TRAN / Mobile</Text>
          <View style={styles.localeRow}>
            {(['en', 'ne', 'hi'] as SupportedLocale[]).map((loc) => (
              <TouchableOpacity
                key={loc}
                onPress={() => setLocale(loc)}
                style={[styles.localeBtn, locale === loc && styles.localeBtnActive]}
              >
                <Text style={[styles.localeText, locale === loc && styles.localeTextActive]}>
                  {loc.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.themeRow}>
          {(['dark', 'light'] as ThemeMode[]).map((mode) => (
            <TouchableOpacity key={mode} onPress={() => setThemeMode(mode)}>
              <Text style={{ color: themeMode === mode ? theme.palette.primary : theme.palette.text.secondary }}>
                {mode === 'light' ? t('app.themeLight', locale) : t('app.themeDark', locale)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[styles.title, { color: theme.palette.text.primary }]}>{t('app.title', locale)}</Text>
        <Text style={[styles.subtitle, { color: theme.palette.text.secondary }]}>{t('app.subtitle', locale)}</Text>

        <GlassCard variant="prominent" style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{t('app.checkOffline', locale)}</Text>
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
              <GlassInput label={t('app.countryLabel', locale)} value={country} onChangeText={setCountry} />
            </View>
          </View>

          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: theme.palette.primary }]} onPress={handleApi}>
            <Text style={styles.actionBtnText}>{t('app.checkButton', locale)}</Text>
          </TouchableOpacity>

          <View style={[styles.resultBox, { borderColor: eligibilityColor, backgroundColor: `${eligibilityColor}22` }]}>
            <Text style={{ color: eligibilityColor, fontWeight: '700' }}>
              {display.eligible ? t('app.eligibleYes', locale) : t('app.eligibleNo', locale)}
            </Text>
            <Text style={{ color: theme.palette.text.secondary, marginTop: 4 }}>{display.reason}</Text>
          </View>
        </GlassCard>

        <GlassCard variant="subtle" style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{t('app.status', locale)}</Text>
          {loading ? (
            <SkeletonView count={3} height={24} />
          ) : health ? (
            <Text style={{ color: liquidGlassTokens.palette.success }}>● {health.overall_status}</Text>
          ) : (
            <Text style={{ color: theme.palette.warning }}>{t('app.offlineNotice', locale)}</Text>
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
    borderColor: liquidGlassTokens.glass.border.subtle,
  },
  localeBtnActive: {
    borderColor: liquidGlassTokens.palette.primary,
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
  },
  localeText: { color: liquidGlassTokens.palette.text.secondary, fontSize: 12 },
  localeTextActive: { color: liquidGlassTokens.palette.primary, fontWeight: '600' },
  title: { fontSize: 26, fontWeight: '800', marginBottom: 6 },
  subtitle: { fontSize: 14, marginBottom: 20 },
  sectionCard: { marginBottom: 20 },
  sectionTitle: { color: liquidGlassTokens.palette.text.primary, fontSize: 16, fontWeight: '700', marginBottom: 12 },
  inputRow: { flexDirection: 'row', marginBottom: 12 },
  actionBtn: { paddingVertical: 12, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  actionBtnText: { color: '#0b0f19', fontWeight: '700', fontSize: 15 },
  resultBox: { marginTop: 14, padding: 12, borderRadius: 10, borderWidth: 1 },
});
