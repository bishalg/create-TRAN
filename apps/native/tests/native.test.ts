import { describe, it, expect } from 'vitest';
import { liquidGlassTokens } from '@tran/core';

describe('Native App Core', () => {
  it('should use design system radii and background tokens', () => {
    expect(liquidGlassTokens.radii.md).toBe('14px');
    expect(liquidGlassTokens.glass.background.subtle).toBeDefined();
  });
});
