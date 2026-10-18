import { liquidGlassTokens } from '@tran/core';
import { describe, expect, it } from 'vitest';

describe('web design tokens', () => {
  it('consumes the shared glass tokens', () => {
    expect(liquidGlassTokens.glass.background.standard).toBeDefined();
    expect(liquidGlassTokens.radii.lg).toBe('20px');
  });
});
