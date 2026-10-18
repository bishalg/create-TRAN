import { useEffect, useState } from 'react';
import type { SupportedLocale, ThemeMode } from '@tran/core';
import { initialTheme } from '../shared/lib/theme.js';

/** UI preferences that live on <html>: colour theme and document language. */
export function usePreferences() {
  const [locale, setLocale] = useState<SupportedLocale>('en');
  const [theme, setTheme] = useState<ThemeMode>(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Screen readers pick their pronunciation voice from <html lang>.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return {
    locale,
    setLocale,
    theme,
    toggleTheme: () => setTheme((current) => (current === 'dark' ? 'light' : 'dark')),
  };
}
