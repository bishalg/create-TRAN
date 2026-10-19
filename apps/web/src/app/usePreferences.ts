import { useCallback, useEffect, useState } from 'react';
import type { SupportedLocale, ThemeMode } from '@tran/core';
import { initialTheme, persistTheme } from '../shared/lib/theme.js';

/** UI preferences that live on <html>: colour theme and document language. */
export function usePreferences() {
  const [locale, setLocale] = useState<SupportedLocale>('en');
  const [theme, setThemeState] = useState<ThemeMode>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Screen readers pick their pronunciation voice from <html lang>.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  // Any registered theme can be selected — no light/dark toggle.
  const setTheme = useCallback((next: ThemeMode) => {
    setThemeState(next);
    persistTheme(next);
  }, []);

  return {
    locale,
    setLocale,
    theme,
    setTheme,
  };
}
