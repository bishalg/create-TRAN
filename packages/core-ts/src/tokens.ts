/**
 * Liquid Glass design tokens with light/dark semantic palettes.
 * Zero React dependency — shared by web and native.
 */

const sharedStructure = {
  glass: {
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
} as const;

export type ThemeMode = 'light' | 'dark';

export interface ThemeTokens {
  mode: ThemeMode;
  glass: {
    background: {
      subtle: string;
      standard: string;
      prominent: string;
      dark: string;
    };
    border: {
      subtle: string;
      standard: string;
      highlight: string;
    };
    blur: typeof sharedStructure.glass.blur;
    shadow: typeof sharedStructure.glass.shadow;
  };
  radii: typeof sharedStructure.radii;
  palette: {
    primary: string;
    primaryGlow: string;
    accent: string;
    success: string;
    warning: string;
    danger: string;
    eligibility: {
      canVote: string;
      cannotVote: string;
      neutral: string;
    };
    text: {
      primary: string;
      secondary: string;
      muted: string;
    };
  };
}

const darkTheme: ThemeTokens = {
  mode: 'dark',
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
    ...sharedStructure.glass,
  },
  radii: sharedStructure.radii,
  palette: {
    primary: '#38bdf8',
    primaryGlow: 'rgba(56, 189, 248, 0.35)',
    accent: '#818cf8',
    success: '#34d399',
    warning: '#fbbf24',
    danger: '#f87171',
    eligibility: {
      canVote: '#34d399',
      cannotVote: '#f87171',
      neutral: '#94a3b8',
    },
    text: {
      primary: '#f8fafc',
      secondary: '#94a3b8',
      muted: '#64748b',
    },
  },
};

const lightTheme: ThemeTokens = {
  mode: 'light',
  glass: {
    background: {
      subtle: 'rgba(15, 23, 42, 0.04)',
      standard: 'rgba(15, 23, 42, 0.08)',
      prominent: 'rgba(15, 23, 42, 0.12)',
      dark: 'rgba(248, 250, 252, 0.92)',
    },
    border: {
      subtle: 'rgba(15, 23, 42, 0.08)',
      standard: 'rgba(15, 23, 42, 0.14)',
      highlight: 'rgba(15, 23, 42, 0.22)',
    },
    ...sharedStructure.glass,
  },
  radii: sharedStructure.radii,
  palette: {
    primary: '#0284c7',
    primaryGlow: 'rgba(2, 132, 199, 0.25)',
    accent: '#4f46e5',
    success: '#059669',
    warning: '#d97706',
    danger: '#dc2626',
    eligibility: {
      canVote: '#059669',
      cannotVote: '#dc2626',
      neutral: '#475569',
    },
    text: {
      primary: '#0f172a',
      secondary: '#475569',
      muted: '#64748b',
    },
  },
};

export const themeTokens: Record<ThemeMode, ThemeTokens> = {
  dark: darkTheme,
  light: lightTheme,
};

export function getThemeTokens(mode: ThemeMode = 'dark'): ThemeTokens {
  return themeTokens[mode];
}

/** Default export for backward compatibility — dark theme. */
export const liquidGlassTokens = darkTheme;

export type LiquidGlassTokens = ThemeTokens;
