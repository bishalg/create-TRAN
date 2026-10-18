import React, { useState } from 'react';
import { type SupportedLocale, liquidGlassTokens, t } from '@tran/core';
import { GlassCard } from './components/ui/GlassCard.js';
import { GlassInput } from './components/ui/GlassInput.js';
import { SkeletonView } from './components/ui/SkeletonView.js';
import { Header } from './components/layout/Header.js';
import { useTranApi } from './hooks/useTranApi.js';

export const App: React.FC = () => {
  const [locale, setLocale] = useState<SupportedLocale>('en');
  const [numA, setNumA] = useState('12');
  const [numB, setNumB] = useState('8');
  const [op, setOp] = useState('multiply');

  const { health, info, isLoading, isOffline, error, lastCalculation, executeCompute } =
    useTranApi();

  const handleCompute = async () => {
    const a = parseFloat(numA);
    const b = parseFloat(numB);
    if (!isNaN(a) && !isNaN(b)) {
      await executeCompute({ a, b, operation: op });
    }
  };

  const layers = [
    { code: 'T', name: 'TanStack Start', role: 'Full-stack SSR & Router', color: '#f59e0b' },
    { code: 'R', name: 'Rust Core', role: 'High-performance shared engine', color: '#ef4444' },
    { code: 'A', name: 'Axum Microservice', role: 'Tokio async API gateway', color: '#10b981' },
    {
      code: 'N',
      name: 'Native iOS & Android',
      role: 'React Native / Expo mobile app',
      color: '#6366f1',
    },
  ];

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Header
        currentLocale={locale}
        onLocaleChange={setLocale}
        breadcrumbs={[t('app.title', locale), 'Dashboard']}
      />

      <main style={{ maxWidth: '1080px', margin: '0 auto', width: '100%', padding: '2rem 1rem' }}>
        {/* Banner */}
        <section style={{ textAlign: 'center', marginBottom: '3rem' }}>
          <div
            style={{
              display: 'inline-flex',
              padding: '0.25rem 1rem',
              borderRadius: liquidGlassTokens.radii.pill,
              backgroundColor: 'rgba(56, 189, 248, 0.1)',
              border: `1px solid ${liquidGlassTokens.palette.primaryGlow}`,
              color: liquidGlassTokens.palette.primary,
              fontSize: '0.85rem',
              fontWeight: 500,
              marginBottom: '1rem',
            }}
          >
            Nx Monorepo Template
          </div>
          <h1
            style={{
              fontSize: '2.75rem',
              fontWeight: 800,
              letterSpacing: '-0.03em',
              margin: '0.5rem 0',
              background: 'linear-gradient(135deg, #f8fafc 0%, #94a3b8 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            {t('app.title', locale)}
          </h1>
          <p style={{ color: liquidGlassTokens.palette.text.secondary, fontSize: '1.15rem' }}>
            {t('app.subtitle', locale)}
          </p>
        </section>

        {/* Offline indicator */}
        {isOffline && (
          <div
            style={{
              padding: '0.75rem 1.25rem',
              borderRadius: liquidGlassTokens.radii.md,
              backgroundColor: 'rgba(251, 191, 36, 0.1)',
              border: `1px solid ${liquidGlassTokens.palette.warning}`,
              color: liquidGlassTokens.palette.warning,
              marginBottom: '2rem',
              fontSize: '0.9rem',
              textAlign: 'center',
            }}
          >
            {t('app.offlineNotice', locale)}
          </div>
        )}

        {/* 4 Stack Layers Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '1.25rem',
            marginBottom: '2.5rem',
          }}
        >
          {layers.map((layer) => (
            <GlassCard key={layer.code} variant="standard">
              <div
                style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: liquidGlassTokens.radii.md,
                  backgroundColor: `${layer.color}22`,
                  border: `1px solid ${layer.color}66`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 800,
                  fontSize: '1.2rem',
                  color: layer.color,
                  marginBottom: '1rem',
                }}
              >
                {layer.code}
              </div>
              <h3 style={{ margin: '0 0 0.25rem 0', fontSize: '1.1rem' }}>{layer.name}</h3>
              <p
                style={{
                  margin: 0,
                  fontSize: '0.85rem',
                  color: liquidGlassTokens.palette.text.secondary,
                }}
              >
                {layer.role}
              </p>
            </GlassCard>
          ))}
        </div>

        {/* Interactive Computation Section */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: '1.5rem',
          }}
        >
          {/* Rust Core Computation Console */}
          <GlassCard variant="prominent">
            <h2 style={{ fontSize: '1.25rem', marginTop: 0 }}>Rust Core Engine</h2>
            <p
              style={{
                fontSize: '0.85rem',
                color: liquidGlassTokens.palette.text.secondary,
                marginBottom: '1.5rem',
              }}
            >
              Dispatch deterministic calculations directly into Rust Core via Axum.
            </p>

            <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
              <GlassInput
                label="Operand A"
                type="number"
                value={numA}
                onChange={(e) => setNumA(e.target.value)}
              />
              <GlassInput
                label="Operand B"
                type="number"
                value={numB}
                onChange={(e) => setNumB(e.target.value)}
              />
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label
                style={{
                  fontSize: '0.875rem',
                  color: liquidGlassTokens.palette.text.secondary,
                  display: 'block',
                  marginBottom: '0.4rem',
                }}
              >
                Operation
              </label>
              <select
                value={op}
                onChange={(e) => setOp(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  backgroundColor: liquidGlassTokens.glass.background.subtle,
                  borderRadius: liquidGlassTokens.radii.md,
                  border: `1px solid ${liquidGlassTokens.glass.border.standard}`,
                  color: '#fff',
                  outline: 'none',
                }}
              >
                <option value="multiply" style={{ backgroundColor: '#1e293b' }}>
                  Multiply (a * b)
                </option>
                <option value="add" style={{ backgroundColor: '#1e293b' }}>
                  Add (a + b)
                </option>
                <option value="subtract" style={{ backgroundColor: '#1e293b' }}>
                  Subtract (a - b)
                </option>
                <option value="divide" style={{ backgroundColor: '#1e293b' }}>
                  Divide (a / b)
                </option>
                <option value="power" style={{ backgroundColor: '#1e293b' }}>
                  Power (a ^ b)
                </option>
              </select>
            </div>

            <button
              onClick={handleCompute}
              style={{
                width: '100%',
                padding: '0.85rem',
                borderRadius: liquidGlassTokens.radii.md,
                border: 'none',
                background: `linear-gradient(135deg, ${liquidGlassTokens.palette.primary} 0%, ${liquidGlassTokens.palette.accent} 100%)`,
                color: '#0f172a',
                fontWeight: 700,
                fontSize: '0.95rem',
                cursor: 'pointer',
                transition: 'opacity 0.2s ease',
              }}
            >
              {t('app.computeButton', locale)}
            </button>

            {lastCalculation && (
              <div
                style={{
                  marginTop: '1.25rem',
                  padding: '1rem',
                  borderRadius: liquidGlassTokens.radii.md,
                  backgroundColor: 'rgba(52, 211, 153, 0.1)',
                  border: `1px solid ${liquidGlassTokens.palette.success}`,
                }}
              >
                <div style={{ fontSize: '0.8rem', color: liquidGlassTokens.palette.success }}>
                  Calculated in {lastCalculation.execution_micros}µs
                </div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: '0.25rem' }}>
                  Result: {lastCalculation.result}
                </div>
              </div>
            )}

            {error && (
              <div
                style={{
                  marginTop: '1rem',
                  color: liquidGlassTokens.palette.danger,
                  fontSize: '0.85rem',
                }}
              >
                {error}
              </div>
            )}
          </GlassCard>

          {/* System Health / Status Card */}
          <GlassCard variant="standard">
            <h2 style={{ fontSize: '1.25rem', marginTop: 0 }}>{t('app.status', locale)}</h2>

            {isLoading ? (
              <div style={{ paddingTop: '1rem' }}>
                <SkeletonView count={3} height="28px" />
              </div>
            ) : health ? (
              <div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    color: liquidGlassTokens.palette.success,
                    fontWeight: 600,
                    marginBottom: '1rem',
                  }}
                >
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: liquidGlassTokens.palette.success,
                    }}
                  />
                  {health.overall_status}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {health.components.map((comp) => (
                    <div
                      key={comp.name}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        padding: '0.6rem 0.8rem',
                        borderRadius: liquidGlassTokens.radii.sm,
                        backgroundColor: 'rgba(255, 255, 255, 0.03)',
                        fontSize: '0.85rem',
                      }}
                    >
                      <span>{comp.name}</span>
                      <span style={{ color: liquidGlassTokens.palette.primary }}>
                        v{comp.version}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ color: liquidGlassTokens.palette.text.secondary, fontSize: '0.9rem' }}>
                Backend service currently running on standby.
              </div>
            )}
          </GlassCard>
        </div>
      </main>
    </div>
  );
};
