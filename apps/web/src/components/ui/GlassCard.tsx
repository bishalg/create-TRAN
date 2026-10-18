import React, { type CSSProperties, type ReactNode } from 'react';
import { liquidGlassTokens, type ThemeTokens } from '@tran/core';

export interface GlassCardProps {
  children: ReactNode;
  theme?: ThemeTokens;
  variant?: 'subtle' | 'standard' | 'prominent';
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
  /** id of the heading inside the card; exposes the card as a named landmark region. */
  labelledBy?: string;
}

/**
 * Pure "Dumb" View component adhering to the Liquid Glass design specification.
 * Contains no data-fetching or state side-effects.
 */
export const GlassCard: React.FC<GlassCardProps> = ({
  children,
  variant = 'standard',
  theme = liquidGlassTokens,
  className = '',
  style = {},
  onClick,
  labelledBy,
}) => {
  const bg = theme.glass.background[variant];
  const border = theme.glass.border.standard;
  const blur = theme.glass.blur.md;
  const shadow = theme.glass.shadow.ambient;
  const radius = theme.radii.lg;

  const cardStyle: CSSProperties = {
    backgroundColor: bg,
    backdropFilter: `blur(${blur})`,
    WebkitBackdropFilter: `blur(${blur})`,
    border: `1px solid ${border}`,
    borderRadius: radius,
    boxShadow: shadow,
    padding: '1.5rem',
    color: theme.palette.text.primary,
    transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
    cursor: onClick ? 'pointer' : 'default',
    ...style,
  };

  return (
    <section
      className={`glass-card ${className}`}
      style={cardStyle}
      onClick={onClick}
      aria-labelledby={labelledBy}
    >
      {children}
    </section>
  );
};
