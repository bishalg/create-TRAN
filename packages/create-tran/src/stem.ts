/** Default code stem shipped in the TRAN template. */
export const DEFAULT_STEM = 'tran';

/** Light-theme brand primary in `crates/rust-core/src/tokens.rs`. */
export const TEMPLATE_LIGHT_PRIMARY = '#0284c7';
/** Dark / black theme brand primary in tokens.rs. */
export const TEMPLATE_DARK_PRIMARY = '#38bdf8';

export interface StemForms {
  /** lowercase package / css stem, e.g. `acme` */
  lower: string;
  /** PascalCase type prefix, e.g. `Acme` */
  pascal: string;
  /** UPPER_SNAKE env prefix, e.g. `ACME` */
  upper: string;
}

/**
 * Validate a user code stem: 2–12 chars, lowercase letter then alphanumeric.
 * This is the single coding prefix (`@stem/`, `--stem-`, `Stem`, `STEM_`).
 */
export function normalizeStem(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateStem(raw: string): string | null {
  const stem = normalizeStem(raw);
  if (!/^[a-z][a-z0-9]{1,11}$/.test(stem)) {
    return 'Prefix must be 2–12 characters: start with a letter, then lowercase letters or digits (e.g. acme, myapp).';
  }
  const reserved = new Set([
    'node',
    'test',
    'src',
    'app',
    'apps',
    'com',
    'org',
    'www',
    'lib',
    'bin',
    'npm',
    'pnpm',
  ]);
  if (reserved.has(stem)) {
    return `Prefix "${stem}" is reserved; pick another.`;
  }
  return null;
}

export function stemForms(raw: string): StemForms {
  const lower = normalizeStem(raw);
  const err = validateStem(lower);
  if (err) {
    throw new Error(err);
  }
  return {
    lower,
    pascal: lower.charAt(0).toUpperCase() + lower.slice(1),
    upper: lower.toUpperCase(),
  };
}

export function validateHexColor(raw: string): string | null {
  const value = raw.trim();
  if (!value) {
    return null;
  }
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)) {
    return 'Color must be a hex value like #0284c7 or #0af.';
  }
  return null;
}

export function normalizeHexColor(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(value)) {
    const r = value[1];
    const g = value[2];
    const b = value[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  if (/^#[0-9a-f]{8}$/.test(value)) {
    return value.slice(0, 7);
  }
  return value;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const digits = normalizeHexColor(hex).slice(1);
  return {
    r: Number.parseInt(digits.slice(0, 2), 16),
    g: Number.parseInt(digits.slice(2, 4), 16),
    b: Number.parseInt(digits.slice(4, 6), 16),
  };
}

export function glowRgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Rewrite template identifiers from `tran` / `Tran` / `TRAN_` to the user stem.
 * Protects the upstream GitHub template URL so clones stay pointed at create-TRAN.
 */
export function applyStemRewrite(content: string, stem: string): string {
  const forms = stemForms(stem);
  if (forms.lower === DEFAULT_STEM) {
    return content;
  }

  const { lower, pascal, upper } = forms;
  const protectedUrls: string[] = [];
  let out = content.replace(/https:\/\/github\.com\/bishalg\/create-TRAN(?:\.git)?/g, (match) => {
    const token = `\0TRANURL${protectedUrls.length}\0`;
    protectedUrls.push(match);
    return token;
  });

  const replacements: Array<[RegExp, string]> = [
    [/EXPO_PUBLIC_TRAN_/g, `EXPO_PUBLIC_${upper}_`],
    [/VITE_TRAN_/g, `VITE_${upper}_`],
    [/TRAN_/g, `${upper}_`],
    [/@tran\//g, `@${lower}/`],
    [/--tran-/g, `--${lower}-`],
    [/com\.tran\./g, `com.${lower}.`],
    [/create-tran/g, `create-${lower}`],
    [/tran-tokens-codegen/g, `${lower}-tokens-codegen`],
    [/tran-uniffi/g, `${lower}-uniffi`],
    [/tran_tokens_codegen/g, `${lower}_tokens_codegen`],
    [/tran_uniffi/g, `${lower}_uniffi`],
    [/Tran(?=[A-Z])/g, pascal],
    [/\bTran\b/g, pascal],
    [/\btran-/g, `${lower}-`],
    [/\btran_/g, `${lower}_`],
  ];

  for (const [pattern, replacement] of replacements) {
    out = out.replace(pattern, replacement);
  }

  protectedUrls.forEach((url, index) => {
    out = out.replace(`\0TRANURL${index}\0`, url);
  });

  return out;
}

/** Patch brand primary + glow in tokens.rs when the user picks a color. */
export function applyPrimaryColor(content: string, primaryHex: string): string {
  const hex = normalizeHexColor(primaryHex);
  const err = validateHexColor(hex);
  if (err) {
    throw new Error(err);
  }

  let out = content;
  out = out.split(TEMPLATE_DARK_PRIMARY).join(hex);
  out = out.split(TEMPLATE_LIGHT_PRIMARY).join(hex);
  out = out.split('rgba(56, 189, 248, 0.35)').join(glowRgba(hex, 0.35));
  out = out.split('rgba(2, 132, 199, 0.25)').join(glowRgba(hex, 0.25));
  return out;
}

const DEFAULT_THEME_CONST = 'pub const DEFAULT_THEME: &str = "dark";';

/** Patch `DEFAULT_THEME` in tokens.rs (`light` | `dark` | `black` | `sepia`). */
export function applyDefaultTheme(content: string, theme: string): string {
  const mode = theme.trim().toLowerCase();
  if (!['light', 'dark', 'black', 'sepia'].includes(mode)) {
    throw new Error(`Invalid default theme: ${theme}`);
  }
  if (mode === 'dark') {
    return content;
  }
  return content.replace(DEFAULT_THEME_CONST, `pub const DEFAULT_THEME: &str = "${mode}";`);
}
