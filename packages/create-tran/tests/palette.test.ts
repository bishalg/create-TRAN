import { describe, it, expect } from 'vitest';
import {
  STARTER_COLORS,
  deriveDisplayName,
  pickRandomStarterColor,
  resolveColorChoice,
  validateThemeMode,
} from '../src/palette.js';

describe('starter palette', () => {
  it('exposes five template brand colors', () => {
    expect(STARTER_COLORS).toHaveLength(5);
    expect(STARTER_COLORS.map((c) => c.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it('picks a deterministic color with an injected random source', () => {
    const picked = pickRandomStarterColor(() => 0);
    expect(picked).toEqual(STARTER_COLORS[0]);
    const last = pickRandomStarterColor(() => 0.99);
    expect(last).toEqual(STARTER_COLORS[4]);
  });

  it('resolves Enter as a random starter color', () => {
    const choice = resolveColorChoice('', () => 0.5);
    expect(choice.random).toBe(true);
    expect(STARTER_COLORS.some((c) => c.hex === choice.hex)).toBe(true);
  });

  it('resolves 1-5 and hex choices', () => {
    expect(resolveColorChoice('3').hex).toBe('#4f46e5');
    expect(resolveColorChoice('3').random).toBe(false);
    expect(resolveColorChoice('#0ea5e9').hex).toBe('#0ea5e9');
  });
});

describe('theme and display name helpers', () => {
  it('validates theme modes', () => {
    expect(validateThemeMode('light')).toBe('light');
    expect(validateThemeMode('DARK')).toBe('dark');
    expect(validateThemeMode('neon')).toBeNull();
  });

  it('derives a display name from the project folder', () => {
    expect(deriveDisplayName('my-tran-app')).toBe('My Tran App');
    expect(deriveDisplayName('acme_voting')).toBe('Acme Voting');
  });
});
