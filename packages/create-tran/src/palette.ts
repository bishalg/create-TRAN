/**
 * Curated brand primaries from the TRAN template themes
 * (`crates/rust-core/src/tokens.rs` light / dark / accent / sepia).
 */
export interface StarterColor {
  id: number;
  name: string;
  hex: string;
}

export const STARTER_COLORS: readonly StarterColor[] = [
  { id: 1, name: 'Ocean', hex: '#0284c7' },
  { id: 2, name: 'Sky', hex: '#38bdf8' },
  { id: 3, name: 'Indigo', hex: '#4f46e5' },
  { id: 4, name: 'Violet', hex: '#818cf8' },
  { id: 5, name: 'Sepia', hex: '#8a5a24' },
] as const;

export const THEME_MODES = ['light', 'dark', 'black', 'sepia'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];
export const DEFAULT_THEME_MODE: ThemeMode = 'dark';

export function formatStarterPalette(): string {
  return STARTER_COLORS.map((c) => `  ${c.id}) ${c.name.padEnd(8)} ${c.hex}`).join('\n');
}

export function pickRandomStarterColor(random: () => number = Math.random): StarterColor {
  const index = Math.floor(random() * STARTER_COLORS.length);
  return STARTER_COLORS[Math.min(index, STARTER_COLORS.length - 1)]!;
}

export function starterColorById(id: number): StarterColor | undefined {
  return STARTER_COLORS.find((c) => c.id === id);
}

/**
 * Resolve a color prompt answer:
 * - empty → random starter color
 * - `1`–`5` → that starter color
 * - `#hex` → custom
 */
export function resolveColorChoice(
  raw: string,
  random: () => number = Math.random
): { hex: string; label: string; random: boolean } {
  const trimmed = raw.trim();
  if (!trimmed) {
    const picked = pickRandomStarterColor(random);
    return {
      hex: picked.hex,
      label: `${picked.name} (${picked.hex})`,
      random: true,
    };
  }

  if (/^[1-5]$/.test(trimmed)) {
    const picked = starterColorById(Number(trimmed))!;
    return {
      hex: picked.hex,
      label: `${picked.name} (${picked.hex})`,
      random: false,
    };
  }

  return {
    hex: trimmed,
    label: trimmed,
    random: false,
  };
}

export function validateThemeMode(raw: string): ThemeMode | null {
  const value = raw.trim().toLowerCase();
  return (THEME_MODES as readonly string[]).includes(value) ? (value as ThemeMode) : null;
}

/** `my-tran-app` → `My Tran App` */
export function deriveDisplayName(projectName: string): string {
  return projectName
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}
