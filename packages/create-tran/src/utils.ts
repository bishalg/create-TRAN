import * as fs from 'node:fs';
import * as path from 'node:path';

export const DEFAULT_TEMPLATE_REPO = 'https://github.com/bishalg/create-TRAN.git';
export const PINNED_PNPM = 'pnpm@11.22.0';

export interface CliOptions {
  projectName: string;
  targetDir: string;
  packageManager: 'pnpm' | 'npm' | 'bun' | 'yarn';
  includeNative: boolean;
  initGit: boolean;
  /** Override template source (git URL or local path). Useful for tests. */
  templateUrl?: string;
}

export function parseArgs(
  rawArgs: string[]
): Partial<CliOptions> & { help?: boolean; version?: boolean } {
  const options: Partial<CliOptions> & { help?: boolean; version?: boolean } = {};
  const positional: string[] = [];

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--version' || arg === '-v') {
      options.version = true;
    } else if (arg === '--no-git') {
      options.initGit = false;
    } else if (arg === '--no-native') {
      options.includeNative = false;
    } else if (arg === '--pm' || arg === '--package-manager') {
      const next = rawArgs[++i];
      if (next && ['pnpm', 'npm', 'bun', 'yarn'].includes(next)) {
        options.packageManager = next as CliOptions['packageManager'];
      }
    } else if (arg === '--template') {
      const next = rawArgs[++i];
      if (next) {
        options.templateUrl = next;
      }
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  if (positional.length > 0) {
    options.projectName = positional[0];
  }

  return options;
}

export function ensureDirectory(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function writeTemplateFile(filePath: string, content: string): void {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, content.trimStart(), 'utf-8');
}

export function assertTargetAvailable(targetDir: string): void {
  if (!fs.existsSync(targetDir)) {
    return;
  }
  const entries = fs.readdirSync(targetDir).filter((name) => name !== '.DS_Store');
  if (entries.length > 0) {
    throw new Error(
      `Target directory already exists and is not empty: ${targetDir}\n` +
        'Choose a different name or remove the directory first.'
    );
  }
}

export function packageManagerField(pm: CliOptions['packageManager']): string {
  if (pm === 'pnpm') {
    return PINNED_PNPM;
  }
  return `${pm}@latest`;
}
