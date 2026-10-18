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
  type CalculationResponse,
  liquidGlassTokens,
  t,
  type SupportedLocale,
  TranApiClient,
  type TranHealthReport,
} from '@tran/core';
import { GlassCard } from '../components/GlassCard.js';
import { GlassInput } from '../components/GlassInput.js';
import { SkeletonView } from '../components/SkeletonView.js';

export const HomeScreen: React.FC = () => {
  const [locale, setLocale] = useState<SupportedLocale>('en');
  const [health, setHealth] = useState<TranHealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [valA, setValA] = useState('8');
  const [valB, setValB] = useState('5');
  const [result, setResult] = useState<CalculationResponse | null>(null);

  const client = new TranApiClient({ baseUrl: 'http://localhost:3001' });

  useEffect(() => {
    client
      .getHealth()
      .then((h) => setHealth(h))
      .catch(() => {
        // Fallback offline mode
      })
      .finally(() => setLoading(false));
  }, []);

  const handleCompute = async () => {
    const a = parseFloat(valA);
    const b = parseFloat(valB);
    if (!isNaN(a) && !isNaN(b)) {
      try {
        const res = await client.compute({ a, b, operation: 'multiply' });
        setResult(res);
      } catch {
        // Handle error
      }
    }
  };

  const layers = [
    { code: 'T', name: 'TanStack Start' },
    { code: 'R', name: 'Rust Core' },
    { code: 'A', name: 'Axum Microservice' },
    { code: 'N', name: 'Native iOS & Android' },
  ];

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.container}>
        {/* Navigation Breadcrumb / Language switcher */}
        <View style={styles.headerRow}>
          <Text style={styles.breadcrumb}>TRAN / Mobile</Text>
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

        {/* Title */}
        <Text style={styles.title}>{t('app.title', locale)}</Text>
        <Text style={styles.subtitle}>{t('app.subtitle', locale)}</Text>

        {/* Stack Layers */}
        <View style={styles.grid}>
          {layers.map((layer) => (
            <GlassCard key={layer.code} style={styles.layerCard} variant="standard">
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{layer.code}</Text>
              </View>
              <Text style={styles.layerName}>{layer.name}</Text>
            </GlassCard>
          ))}
        </View>

        {/* Interactive Computation */}
        <GlassCard variant="prominent" style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Rust Core Engine (via Axum)</Text>
          <View style={styles.inputRow}>
            <View style={{ flex: 1 }}>
              <GlassInput
                label="Operand A"
                value={valA}
                onChangeText={setValA}
                keyboardType="numeric"
              />
            </View>
            <View style={{ width: 12 }} />
            <View style={{ flex: 1 }}>
              <GlassInput
                label="Operand B"
                value={valB}
                onChangeText={setValB}
                keyboardType="numeric"
              />
            </View>
          </View>

          <TouchableOpacity style={styles.actionBtn} onPress={handleCompute}>
            <Text style={styles.actionBtnText}>{t('app.computeButton', locale)}</Text>
          </TouchableOpacity>

          {result && (
            <View style={styles.resultBox}>
              <Text style={styles.resultMicros}>Computed in {result.execution_micros}µs</Text>
              <Text style={styles.resultValue}>Result: {result.result}</Text>
            </View>
          )}
        </GlassCard>

        {/* System Health */}
        <GlassCard variant="subtle" style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>{t('app.status', locale)}</Text>
          {loading ? (
            <SkeletonView count={3} height={24} />
          ) : health ? (
            <View>
              <Text style={styles.statusText}>● {health.overall_status}</Text>
              {health.components.map((comp) => (
                <Text key={comp.name} style={styles.compRow}>
                  {comp.name} — v{comp.version}
                </Text>
              ))}
            </View>
          ) : (
            <Text style={styles.offlineText}>{t('app.offlineNotice', locale)}</Text>
          )}
        </GlassCard>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0b0f19',
  },
  container: {
    padding: 20,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  breadcrumb: {
    color: liquidGlassTokens.palette.primary,
    fontWeight: '600',
    fontSize: 14,
  },
  localeRow: {
    flexDirection: 'row',
    gap: 6,
  },
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
  localeText: {
    color: liquidGlassTokens.palette.text.secondary,
    fontSize: 12,
  },
  localeTextActive: {
    color: liquidGlassTokens.palette.primary,
    fontWeight: '600',
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: liquidGlassTokens.palette.text.primary,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: liquidGlassTokens.palette.text.secondary,
    marginBottom: 24,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 20,
  },
  layerCard: {
    width: '47%',
    padding: 14,
  },
  badge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(56, 189, 248, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  badgeText: {
    color: liquidGlassTokens.palette.primary,
    fontWeight: '800',
    fontSize: 14,
  },
  layerName: {
    color: liquidGlassTokens.palette.text.primary,
    fontWeight: '600',
    fontSize: 13,
  },
  sectionCard: {
    marginBottom: 20,
  },
  sectionTitle: {
    color: liquidGlassTokens.palette.text.primary,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  inputRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  actionBtn: {
    backgroundColor: liquidGlassTokens.palette.primary,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  actionBtnText: {
    color: '#0b0f19',
    fontWeight: '700',
    fontSize: 15,
  },
  resultBox: {
    marginTop: 14,
    padding: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(52, 211, 153, 0.1)',
    borderWidth: 1,
    borderColor: liquidGlassTokens.palette.success,
  },
  resultMicros: {
    color: liquidGlassTokens.palette.success,
    fontSize: 12,
  },
  resultValue: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 18,
    marginTop: 2,
  },
  statusText: {
    color: liquidGlassTokens.palette.success,
    fontWeight: '600',
    marginBottom: 8,
  },
  compRow: {
    color: liquidGlassTokens.palette.text.secondary,
    fontSize: 13,
    marginVertical: 2,
  },
  offlineText: {
    color: liquidGlassTokens.palette.warning,
    fontSize: 13,
  },
});
