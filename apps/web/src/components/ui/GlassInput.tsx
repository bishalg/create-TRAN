import React, { type CSSProperties, type InputHTMLAttributes, useId } from 'react';
import { liquidGlassTokens, type ThemeTokens } from '@tran/core';

export interface GlassInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  theme?: ThemeTokens;
}

/**
 * Pure "Dumb" View input adhering to Liquid Glass aesthetics.
 */
export const GlassInput: React.FC<GlassInputProps> = ({
  label,
  error,
  theme = liquidGlassTokens,
  className = '',
  style = {},
  ...props
}) => {
  const generatedId = useId();
  const inputId = props.id ?? generatedId;
  const errorId = `${inputId}-error`;

  const inputStyle: CSSProperties = {
    backgroundColor: theme.glass.background.subtle,
    backdropFilter: `blur(${theme.glass.blur.sm})`,
    WebkitBackdropFilter: `blur(${theme.glass.blur.sm})`,
    border: `1px solid ${error ? theme.palette.danger : theme.glass.border.standard}`,
    borderRadius: theme.radii.md,
    color: theme.palette.text.primary,
    padding: '0.75rem 1rem',
    fontSize: '1rem',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    ...style,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', width: '100%' }}>
      {label && (
        <label htmlFor={inputId} style={{ fontSize: '0.875rem', color: theme.palette.text.secondary }}>
          {label}
        </label>
      )}
      <input
        className={`glass-input ${className}`}
        style={inputStyle}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...props}
        id={inputId}
      />
      {error && (
        <span id={errorId} style={{ fontSize: '0.75rem', color: theme.palette.danger }}>
          {error}
        </span>
      )}
    </div>
  );
};
