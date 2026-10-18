import React, { type ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { liquidGlassTokens } from '@tran/core';

export interface GlassCardProps {
  children: ReactNode;
  variant?: 'subtle' | 'standard' | 'prominent';
  style?: ViewStyle;
}

export const GlassCard: React.FC<GlassCardProps> = ({ children, variant = 'standard', style }) => {
  const bg = liquidGlassTokens.glass.background[variant];

  return <View style={[styles.card, { backgroundColor: bg }, style]}>{children}</View>;
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: liquidGlassTokens.glass.border.standard,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
});
