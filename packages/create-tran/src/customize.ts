import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_THEME_MODE, type ThemeMode } from './palette.js';
import {
  DEFAULT_STEM,
  applyDefaultTheme,
  applyPrimaryColor,
  applyStemRewrite,
  normalizeHexColor,
  normalizeStem,
  stemForms,
  validateHexColor,
  validateStem,
} from './stem.js';

const SKIP_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  'target',
  'dist',
  'build',
  '.nx',
  'coverage',
  '.turbo',
]);

const TEXT_EXTENSIONS = new Set([
  '.rs',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.css',
  '.swift',
  '.kt',
  '.kts',
  '.toml',
  '.md',
  '.yml',
  '.yaml',
  '.xml',
  '.gradle',
  '.properties',
  '.example',
  '.xcstrings',
  '.pbxproj',
  '.txt',
  '.feature',
  '.svg',
  '.html',
  '.sh',
]);

const TEXT_BASENAMES = new Set([
  'Dockerfile',
  'Makefile',
  'LICENSE',
  'Cargo.lock',
  '.env',
  '.env.example',
  '.gitignore',
  '.gitattributes',
  'project.yml',
]);

function shouldSkipDir(name: string): boolean {
  return SKIP_DIR_NAMES.has(name);
}

function isTextFile(filePath: string): boolean {
  const base = path.basename(filePath);
  if (TEXT_BASENAMES.has(base)) {
    return true;
  }
  const ext = path.extname(filePath).toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
}

function walkFiles(root: string): string[] {
  const results: string[] = [];

  function visit(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === '.DS_Store') {
        continue;
      }
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!shouldSkipDir(entry.name)) {
          visit(full);
        }
        continue;
      }
      if (entry.isFile() && isTextFile(full)) {
        results.push(full);
      }
    }
  }

  visit(root);
  return results;
}

function walkDirs(root: string): string[] {
  const results: string[] = [];

  function visit(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || shouldSkipDir(entry.name)) {
        continue;
      }
      const full = path.join(dir, entry.name);
      visit(full);
      results.push(full);
    }
  }

  visit(root);
  return results;
}

function patchTokensFile(root: string, primaryColor?: string, defaultTheme?: ThemeMode): void {
  const tokensPath = path.join(root, 'crates', 'rust-core', 'src', 'tokens.rs');
  if (!fs.existsSync(tokensPath)) {
    return;
  }
  let content = fs.readFileSync(tokensPath, 'utf-8');
  const original = content;
  if (primaryColor) {
    content = applyPrimaryColor(content, primaryColor);
  }
  if (defaultTheme && defaultTheme !== DEFAULT_THEME_MODE) {
    content = applyDefaultTheme(content, defaultTheme);
  }
  if (content !== original) {
    fs.writeFileSync(tokensPath, content, 'utf-8');
  }
}

function patchDisplayName(root: string, displayName: string): void {
  const localesRoot = path.join(root, 'locales');
  if (!fs.existsSync(localesRoot)) {
    return;
  }
  for (const locale of fs.readdirSync(localesRoot)) {
    const commonPath = path.join(localesRoot, locale, 'common.json');
    if (!fs.existsSync(commonPath)) {
      continue;
    }
    try {
      const data = JSON.parse(fs.readFileSync(commonPath, 'utf-8')) as Record<string, unknown>;
      data.brand = displayName;
      data.appName = displayName;
      fs.writeFileSync(commonPath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
    } catch {
      // ignore malformed locale files in partial fixtures
    }
  }
}

function rewriteFileContents(root: string, stem: string): void {
  const forms = stemForms(stem);
  if (forms.lower === DEFAULT_STEM) {
    return;
  }

  for (const filePath of walkFiles(root)) {
    const original = fs.readFileSync(filePath, 'utf-8');
    const content = applyStemRewrite(original, forms.lower);
    if (content !== original) {
      fs.writeFileSync(filePath, content, 'utf-8');
    }
  }
}

function renameMatchingDirs(root: string, stem: string): void {
  const forms = stemForms(stem);
  if (forms.lower === DEFAULT_STEM) {
    return;
  }

  const { lower, pascal } = forms;
  const basenameMap: Array<[string, string]> = [
    ['TranVotingDemoUITests', `${pascal}VotingDemoUITests`],
    ['TranVotingDemoTests', `${pascal}VotingDemoTests`],
    ['TranVotingDemo', `${pascal}VotingDemo`],
    ['tran-tokens-codegen', `${lower}-tokens-codegen`],
    ['tran-uniffi', `${lower}-uniffi`],
    ['create-tran', `create-${lower}`],
  ];

  const dirs = walkDirs(root).sort((a, b) => b.length - a.length);

  for (const dir of dirs) {
    const base = path.basename(dir);
    const parent = path.dirname(dir);

    for (const [from, to] of basenameMap) {
      if (base === from) {
        const dest = path.join(parent, to);
        if (!fs.existsSync(dest)) {
          fs.renameSync(dir, dest);
        }
        break;
      }
    }
  }

  const refreshed = walkDirs(root).sort((a, b) => b.length - a.length);
  for (const dir of refreshed) {
    const base = path.basename(dir);
    const parent = path.dirname(dir);
    if (base === DEFAULT_STEM && path.basename(parent) === 'com') {
      const dest = path.join(parent, lower);
      if (!fs.existsSync(dest)) {
        fs.renameSync(dir, dest);
      }
    }
  }
}

export interface CustomizeOptions {
  stem: string;
  /** Optional brand primary hex; omit to keep template colours. */
  primaryColor?: string;
  defaultTheme?: ThemeMode;
  displayName?: string;
}

/**
 * Apply identity customization after the template is cloned into `root`.
 */
export function customizeIdentity(root: string, options: CustomizeOptions): void {
  const stem = normalizeStem(options.stem);
  const stemError = validateStem(stem);
  if (stemError) {
    throw new Error(stemError);
  }

  let primary: string | undefined;
  if (options.primaryColor && options.primaryColor.trim()) {
    const hex = normalizeHexColor(options.primaryColor);
    const colorError = validateHexColor(hex);
    if (colorError) {
      throw new Error(colorError);
    }
    primary = hex;
  }

  rewriteFileContents(root, stem);
  renameMatchingDirs(root, stem);
  patchTokensFile(root, primary, options.defaultTheme);
  if (options.displayName && options.displayName.trim()) {
    patchDisplayName(root, options.displayName.trim());
  }
}
