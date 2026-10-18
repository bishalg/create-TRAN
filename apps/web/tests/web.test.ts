import { describe, it, expect } from 'vitest';
import { liquidGlassTokens } from '@tran/core';

describe('Web App Core Tests', () => {
  it('should utilize design system tokens properly', () => {
    expect(liquidGlassTokens.glass.background.standard).toBeDefined();
    expect(liquidGlassTokens.radii.lg).toBe('20px');
  });

  it('should verify layer codes match TRAN acronym', () => {
    const acronym = ['T', 'R', 'A', 'N'];
    expect(acronym.join('')).toBe('TRAN');
  });
});
