import React from 'react';
import { type SupportedLocale, t } from '@tran/core';
import { liquidGlassTokens } from '@tran/core';

export interface HeaderProps {
  currentLocale: SupportedLocale;
  onLocaleChange: (loc: SupportedLocale) => void;
  breadcrumbs?: string[];
}

export const Header: React.FC<HeaderProps> = ({
  currentLocale,
  onLocaleChange,
  breadcrumbs = ['TRAN', 'Overview'],
}) => {
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '1rem 2rem',
        borderBottom: `1px solid ${liquidGlassTokens.glass.border.subtle}`,
        backdropFilter: `blur(${liquidGlassTokens.glass.blur.md})`,
        WebkitBackdropFilter: `blur(${liquidGlassTokens.glass.blur.md})`,
        backgroundColor: liquidGlassTokens.glass.background.subtle,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
        {breadcrumbs.map((crumb, idx) => (
          <React.Fragment key={crumb}>
            {idx > 0 && <span style={{ color: liquidGlassTokens.palette.text.muted }}>/</span>}
            <span
              style={{
                color:
                  idx === breadcrumbs.length - 1
                    ? liquidGlassTokens.palette.primary
                    : liquidGlassTokens.palette.text.secondary,
                fontWeight: idx === breadcrumbs.length - 1 ? 600 : 400,
              }}
            >
              {crumb}
            </span>
          </React.Fragment>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        {(['en', 'ne', 'hi'] as SupportedLocale[]).map((loc) => (
          <button
            key={loc}
            onClick={() => onLocaleChange(loc)}
            style={{
              padding: '0.35rem 0.75rem',
              borderRadius: liquidGlassTokens.radii.sm,
              border: `1px solid ${
                currentLocale === loc
                  ? liquidGlassTokens.palette.primary
                  : liquidGlassTokens.glass.border.subtle
              }`,
              backgroundColor: currentLocale === loc ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
              color:
                currentLocale === loc
                  ? liquidGlassTokens.palette.primary
                  : liquidGlassTokens.palette.text.secondary,
              cursor: 'pointer',
              fontSize: '0.8rem',
              fontWeight: 500,
            }}
          >
            {loc.toUpperCase()}
          </button>
        ))}
      </div>
    </header>
  );
};
