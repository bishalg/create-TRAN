import { describe, expect, it } from 'vitest';
import { initialTheme } from './theme.js';

describe('initialTheme', () => {
  it('follows the OS preference', () => {
    expect(initialTheme(() => ({ matches: true }))).toBe('light');
    expect(initialTheme(() => ({ matches: false }))).toBe('dark');
  });

  it('defaults to dark when matchMedia is unavailable', () => {
    expect(initialTheme(undefined)).toBe('dark');
  });
});
