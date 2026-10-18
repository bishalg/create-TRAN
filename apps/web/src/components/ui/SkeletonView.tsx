import React, { type CSSProperties } from 'react';
import { liquidGlassTokens } from '@tran/core';

export interface SkeletonViewProps {
  height?: string | number;
  width?: string | number;
  borderRadius?: string;
  count?: number;
  style?: CSSProperties;
}

export const SkeletonView: React.FC<SkeletonViewProps> = ({
  height = '20px',
  width = '100%',
  borderRadius = liquidGlassTokens.radii.sm,
  count = 1,
  style = {},
}) => {
  const baseStyle: CSSProperties = {
    height,
    width,
    borderRadius,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    backgroundImage:
      'linear-gradient(90deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.03) 100%)',
    backgroundSize: '200% 100%',
    animation: 'skeleton-pulse 1.6s ease-in-out infinite',
    marginBottom: count > 1 ? '0.75rem' : '0',
    ...style,
  };

  return (
    <div style={{ width: '100%' }}>
      {Array.from({ length: count }).map((_, idx) => (
        <div key={idx} className="skeleton-pulse" style={baseStyle} />
      ))}
    </div>
  );
};
