// Verifies: REQ-WEB-007 REQ-WEB-014
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialTheme, isThemeMode, persistTheme, THEME_STORAGE_KEY } from '../shared/lib/theme.js';
import { usePreferences } from './usePreferences.js';

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('lang');
});

describe('initialTheme', () => {
  it('prefers the remembered theme over the OS preference', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    expect(initialTheme({ matchMedia: () => ({ matches: true }) })).toBe('sepia');
  });

  it('ignores stored values that are not registered themes', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'neon');
    expect(initialTheme({ matchMedia: () => ({ matches: true }) })).toBe('light');
  });

  it('follows the OS preference when nothing is remembered', () => {
    expect(initialTheme({ matchMedia: () => ({ matches: false }) })).toBe('dark');
    expect(initialTheme({ matchMedia: () => ({ matches: true }) })).toBe('light');
  });

  it('falls back to the registry default without storage or matchMedia', () => {
    vi.stubGlobal('localStorage', undefined);
    vi.stubGlobal('matchMedia', undefined);
    expect(initialTheme()).toBe('dark');
  });

  it('survives storage that throws (private browsing)', () => {
    const storage = {
      getItem: () => {
        throw new Error('blocked');
      },
    };
    expect(initialTheme({ storage })).toBe('dark');
  });

  it('accepts registry themes only', () => {
    expect(isThemeMode('black')).toBe(true);
    expect(isThemeMode('neon')).toBe(false);
    expect(isThemeMode(42)).toBe(false);
  });
});

describe('persistTheme', () => {
  it('writes the choice for the next visit', () => {
    persistTheme('sepia');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('sepia');
  });

  it('swallows unavailable or blocked storage', () => {
    const storage = {
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(() => persistTheme('dark', storage)).not.toThrow();
    vi.stubGlobal('localStorage', undefined);
    expect(() => persistTheme('dark')).not.toThrow();
  });
});

describe('usePreferences', () => {
  it('applies an explicit theme to <html> and remembers it', () => {
    const { result } = renderHook(() => usePreferences());
    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');

    act(() => result.current.setTheme('black'));
    expect(result.current.theme).toBe('black');
    expect(document.documentElement.dataset.theme).toBe('black');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('black');
  });

  it('starts from the remembered theme', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    const { result } = renderHook(() => usePreferences());
    expect(result.current.theme).toBe('sepia');
    expect(document.documentElement.dataset.theme).toBe('sepia');
  });

  it('keeps the document language in sync with the locale', () => {
    const { result } = renderHook(() => usePreferences());
    expect(document.documentElement.lang).toBe('en');
    act(() => result.current.setLocale('ne'));
    expect(document.documentElement.lang).toBe('ne');
  });

  it('localizes the tab title and the meta description', () => {
    const meta = document.createElement('meta');
    meta.name = 'description';
    document.head.append(meta);

    const { result, unmount } = renderHook(() => usePreferences());
    expect(document.title).toBe('Voting Eligibility · TRAN');
    expect(meta.content).toBe('Check the minimum voting age for a country.');

    act(() => result.current.setLocale('ne'));
    expect(document.title).toBe('मतदान योग्यता · TRAN');
    expect(meta.content).toBe('कुनै देशको न्यूनतम मतदान उमेर जाँच गर्नुहोस्।');

    unmount();
    meta.remove();
  });

  it('still syncs the title on a page without a meta description', () => {
    renderHook(() => usePreferences());
    expect(document.title).toBe('Voting Eligibility · TRAN');
  });
});
