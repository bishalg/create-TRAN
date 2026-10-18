/**
 * Liquid Glass Design System Tokens
 * Strict zero-React-dependency design token specification.
 */
export const liquidGlassTokens = {
  glass: {
    background: {
      subtle: 'rgba(255, 255, 255, 0.05)',
      standard: 'rgba(255, 255, 255, 0.10)',
      prominent: 'rgba(255, 255, 255, 0.18)',
      dark: 'rgba(15, 23, 42, 0.65)',
    },
    border: {
      subtle: 'rgba(255, 255, 255, 0.12)',
      standard: 'rgba(255, 255, 255, 0.22)',
      highlight: 'rgba(255, 255, 255, 0.35)',
    },
    blur: {
      sm: '8px',
      md: '16px',
      lg: '24px',
      xl: '40px',
    },
    shadow: {
      ambient: '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
      raised: '0 16px 40px 0 rgba(0, 0, 0, 0.45)',
      insetGlow: 'inset 0 1px 1px 0 rgba(255, 255, 255, 0.25)',
    },
  },
  radii: {
    sm: '8px',
    md: '14px',
    lg: '20px',
    pill: '9999px',
  },
  palette: {
    primary: '#38bdf8', // Sky 400
    primaryGlow: 'rgba(56, 189, 248, 0.35)',
    accent: '#818cf8', // Indigo 400
    success: '#34d399', // Emerald 400
    warning: '#fbbf24', // Amber 400
    danger: '#f87171', // Rose 400
    text: {
      primary: '#f8fafc',
      secondary: '#94a3b8',
      muted: '#64748b',
    },
  },
} as const;

export type LiquidGlassTokens = typeof liquidGlassTokens;
