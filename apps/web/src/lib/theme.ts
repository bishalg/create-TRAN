import type { ThemeMode } from '@tran/core';

/** First paint follows the OS preference; the user's toggle takes over afterwards. */
export function initialTheme(
  matchMedia: ((query: string) => { matches: boolean }) | undefined = globalThis.matchMedia
): ThemeMode {
  return matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
