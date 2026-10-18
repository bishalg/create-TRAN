import React from 'react';
import { StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';
import { liquidGlassTokens } from '@tran/core';

export interface GlassInputProps extends TextInputProps {
  label?: string;
  error?: string;
}

export const GlassInput: React.FC<GlassInputProps> = ({ label, error, style, ...props }) => {
  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      <TextInput
        style={[
          styles.input,
          error ? { borderColor: liquidGlassTokens.palette.danger } : undefined,
          style,
        ]}
        placeholderTextColor={liquidGlassTokens.palette.text.muted}
        {...props}
      />
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    marginVertical: 6,
  },
  label: {
    fontSize: 13,
    color: liquidGlassTokens.palette.text.secondary,
    marginBottom: 4,
    fontWeight: '500',
  },
  input: {
    backgroundColor: liquidGlassTokens.glass.background.subtle,
    borderWidth: 1,
    borderColor: liquidGlassTokens.glass.border.standard,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: liquidGlassTokens.palette.text.primary,
    fontSize: 16,
  },
  error: {
    fontSize: 12,
    color: liquidGlassTokens.palette.danger,
    marginTop: 4,
  },
});
