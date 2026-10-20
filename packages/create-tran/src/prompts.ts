import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  DEFAULT_THEME_MODE,
  deriveDisplayName,
  formatStarterPalette,
  resolveColorChoice,
  type ThemeMode,
  THEME_MODES,
  validateThemeMode,
} from './palette.js';
import {
  DEFAULT_STEM,
  normalizeHexColor,
  normalizeStem,
  validateHexColor,
  validateStem,
} from './stem.js';

export interface PromptAnswers {
  projectName: string;
  stem: string;
  /** Always set after interactive color step (random or chosen). Optional when --yes. */
  primaryColor?: string;
  /** Set when Enter picked a random starter color (for summary). */
  primaryColorLabel?: string;
  includeNative: boolean;
  packageManager: 'pnpm' | 'npm' | 'bun' | 'yarn';
  initGit: boolean;
  defaultTheme: ThemeMode;
  displayName: string;
}

function isInteractive(): boolean {
  return Boolean(input.isTTY && output.isTTY);
}

/**
 * Ask with a visible default. Empty Enter returns the default so
 * Enter / Enter / Enter walks through onboarding quickly.
 */
async function ask(
  rl: readline.Interface,
  question: string,
  defaultValue: string
): Promise<string> {
  const answer = (await rl.question(`${question} (${defaultValue}): `)).trim();
  return answer || defaultValue;
}

async function askYesNo(
  rl: readline.Interface,
  question: string,
  defaultYes: boolean
): Promise<boolean> {
  const hint = defaultYes ? 'Y/n' : 'y/N';
  const raw = (await ask(rl, `${question} [${hint}]`, defaultYes ? 'Y' : 'N')).toLowerCase();
  if (raw === 'y' || raw === 'yes') {
    return true;
  }
  if (raw === 'n' || raw === 'no') {
    return false;
  }
  return defaultYes;
}

/**
 * Fill missing onboarding fields via terminal prompts when stdin is a TTY.
 * Non-interactive callers should pass `--yes` or full flags.
 *
 * Interactive: every question shows a default — press Enter repeatedly to accept all.
 * Color Enter = random pick from the five template brand colors (not “keep as-is”).
 * `--yes` stays deterministic (no random color unless `--primary` is set).
 */
export async function collectOnboardingAnswers(partial: {
  projectName?: string;
  stem?: string;
  primaryColor?: string;
  includeNative?: boolean;
  packageManager?: PromptAnswers['packageManager'];
  initGit?: boolean;
  defaultTheme?: ThemeMode;
  displayName?: string;
  skipPrompts?: boolean;
  /** Injected for tests. */
  random?: () => number;
}): Promise<PromptAnswers> {
  const skip = partial.skipPrompts || !isInteractive();
  const random = partial.random ?? Math.random;

  if (skip) {
    const projectName = partial.projectName || 'my-tran-app';
    return {
      projectName,
      stem: normalizeStem(partial.stem || DEFAULT_STEM),
      primaryColor: partial.primaryColor?.trim()
        ? normalizeHexColor(partial.primaryColor)
        : undefined,
      includeNative: partial.includeNative ?? true,
      packageManager: partial.packageManager || 'pnpm',
      initGit: partial.initGit ?? true,
      defaultTheme: partial.defaultTheme || DEFAULT_THEME_MODE,
      displayName: partial.displayName || deriveDisplayName(projectName),
    };
  }

  const rl = readline.createInterface({ input, output });
  try {
    process.stdout.write('\nOnboarding — customize this TRAN template for your team.\n');
    process.stdout.write(
      'Tip: defaults are in (parentheses). Press Enter repeatedly to accept them all.\n\n'
    );

    let projectName = partial.projectName;
    if (!projectName) {
      projectName = await ask(rl, 'Project name', 'my-tran-app');
    }
    if (!projectName) {
      throw new Error('Project name is required.');
    }

    let stem = partial.stem ? normalizeStem(partial.stem) : '';
    if (!stem) {
      for (;;) {
        const raw = await ask(rl, 'Code prefix (packages, CSS, types, env)', DEFAULT_STEM);
        const candidate = normalizeStem(raw);
        const error = validateStem(candidate);
        if (error) {
          process.stdout.write(`  ⚠ ${error}\n`);
          continue;
        }
        stem = candidate;
        break;
      }
    } else {
      const error = validateStem(stem);
      if (error) {
        throw new Error(error);
      }
    }

    let primaryColor = partial.primaryColor?.trim()
      ? normalizeHexColor(partial.primaryColor)
      : undefined;
    let primaryColorLabel: string | undefined;
    if (partial.primaryColor === undefined) {
      process.stdout.write('\nBrand colors from the template:\n');
      process.stdout.write(`${formatStarterPalette()}\n`);
      for (;;) {
        const raw = (
          await rl.question('Primary color (1-5, #hex, or Enter = random from list): ')
        ).trim();
        const choice = resolveColorChoice(raw, random);
        if (/^[1-5]$/.test(raw) || !raw) {
          primaryColor = choice.hex;
          primaryColorLabel = choice.label;
          process.stdout.write(
            choice.random ? `  → Random pick: ${choice.label}\n` : `  → ${choice.label}\n`
          );
          break;
        }
        const hex = normalizeHexColor(choice.hex);
        const error = validateHexColor(hex);
        if (error) {
          process.stdout.write(`  ⚠ ${error}\n`);
          continue;
        }
        primaryColor = hex;
        primaryColorLabel = hex;
        break;
      }
    }

    let includeNative = partial.includeNative;
    if (includeNative === undefined) {
      includeNative = await askYesNo(rl, 'Include iOS + Android apps?', true);
    }

    let packageManager = partial.packageManager;
    if (!packageManager) {
      for (;;) {
        const raw = await ask(rl, 'Package manager (pnpm/npm/bun/yarn)', 'pnpm');
        if (['pnpm', 'npm', 'bun', 'yarn'].includes(raw)) {
          packageManager = raw as PromptAnswers['packageManager'];
          break;
        }
        process.stdout.write('  ⚠ Choose pnpm, npm, bun, or yarn.\n');
      }
    }

    let initGit = partial.initGit ?? true;
    let defaultTheme: ThemeMode = partial.defaultTheme || DEFAULT_THEME_MODE;
    let displayName = partial.displayName || deriveDisplayName(projectName);

    const wantAdvanced = await askYesNo(rl, 'Configure advanced options?', false);

    if (wantAdvanced) {
      process.stdout.write('\nAdvanced\n');

      displayName = await ask(rl, 'App display name', displayName);

      for (;;) {
        const raw = await ask(rl, `Default theme (${THEME_MODES.join('/')})`, defaultTheme);
        const mode = validateThemeMode(raw);
        if (mode) {
          defaultTheme = mode;
          break;
        }
        process.stdout.write(`  ⚠ Choose one of: ${THEME_MODES.join(', ')}.\n`);
      }

      initGit = await askYesNo(rl, 'Initialize a git repository?', initGit);
    }

    process.stdout.write('\n');

    return {
      projectName,
      stem,
      primaryColor,
      primaryColorLabel,
      includeNative,
      packageManager,
      initGit,
      defaultTheme,
      displayName,
    };
  } finally {
    rl.close();
  }
}
