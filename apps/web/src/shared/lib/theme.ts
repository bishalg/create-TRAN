import { defaultTheme, themeNames, type ThemeMode } from '@tran/core';

/** `index.html` reads this key before first paint — keep both sides in sync. */
export const THEME_STORAGE_KEY = 'tran.theme';

export interface ThemeEnvironment {
  matchMedia?: ((query: string) => { matches: boolean }) | undefined;
  storage?: Pick<Storage, 'getItem'> | undefined;
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && (themeNames as readonly string[]).includes(value);
}

function readStoredTheme(storage: Pick<Storage, 'getItem'> | undefined): string | null {
  try {
    return storage?.getItem(THEME_STORAGE_KEY) ?? null;
  } catch {
    return null; // Private browsing can block storage access.
  }
}

/**
 * First paint follows the remembered choice, then the OS preference, then the
 * registry default. The theme list itself comes from the generated tokens.
 */
export function initialTheme(env: ThemeEnvironment = {}): ThemeMode {
  const stored = readStoredTheme(env.storage ?? globalThis.localStorage);
  if (isThemeMode(stored)) {
    return stored;
  }
  const matchMedia = env.matchMedia ?? globalThis.matchMedia;
  return matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : defaultTheme;
}

export function persistTheme(
  theme: ThemeMode,
  storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage
): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage may be unavailable; the choice then only lasts for this visit.
  }
}
