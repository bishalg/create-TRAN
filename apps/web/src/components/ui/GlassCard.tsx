import React, { type CSSProperties, type ReactNode } from 'react';
import { liquidGlassTokens } from '@tran/core';

export interface GlassCardProps {
  children: ReactNode;
  variant?: 'subtle' | 'standard' | 'prominent';
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
}

/**
 * Pure "Dumb" View component adhering to the Liquid Glass design specification.
 * Contains no data-fetching or state side-effects.
 */
export const GlassCard: React.FC<GlassCardProps> = ({
  children,
  variant = 'standard',
  className = '',
  style = {},
  onClick,
}) => {
  const bg = liquidGlassTokens.glass.background[variant];
  const border = liquidGlassTokens.glass.border.standard;
  const blur = liquidGlassTokens.glass.blur.md;
  const shadow = liquidGlassTokens.glass.shadow.ambient;
  const radius = liquidGlassTokens.radii.lg;

  const cardStyle: CSSProperties = {
    backgroundColor: bg,
    backdropFilter: `blur(${blur})`,
    WebkitBackdropFilter: `blur(${blur})`,
    border: `1px solid ${border}`,
    borderRadius: radius,
    boxShadow: shadow,
    padding: '1.5rem',
    color: liquidGlassTokens.palette.text.primary,
    transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
    cursor: onClick ? 'pointer' : 'default',
    ...style,
  };

  return (
    <div className={`glass-card ${className}`} style={cardStyle} onClick={onClick}>
      {children}
    </div>
  );
};
