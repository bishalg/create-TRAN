#!/usr/bin/env node
/**
 * Feature flag checks (spec 029 REQ-CFG-009, REQ-CFG-010).
 *
 * 1. Stale flags: fails when a flag is past its expiry date (REQ-CFG-009).
 * 2. Unused flags: fails when no client source reads a declared flag through its generated accessor
 *    (REQ-CFG-009). Tests, comments and generated code do not count, nor does spelling the id.
 * 3. Unknown flags: fails when a rule file (`{ "flags": { "<id>": [rules] } }`, the shape the API's
 *    `ConfigSource` reads) names a flag that is not declared (REQ-CFG-009).
 * 4. Safe names: fails on a flag whose name looks like a secret (REQ-CFG-010).
 *
 * Usage:
 *   node tooling/flags/flags.mjs [--root <dir>] [--today YYYY-MM-DD]
 */
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SECRET_WORDS = [
  'secret',
  'token',
  'password',
  'key',
  'credential',
  'private',
  'api_key',
  'apikey',
];

export function isSafeFlagId(id) {
  if (!id || typeof id !== 'string' || id.length > 64) return false;
  const lower = id.toLowerCase();
  return !SECRET_WORDS.some((word) => lower.includes(word));
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** A flag is valid through its expiry day; `referenceDate` is injected so tests never age. */
export function checkFlagExpiry(flag, referenceDate) {
  const expiry = new Date(`${flag.expiry}T00:00:00Z`);
  if (isNaN(expiry.getTime())) {
    return `Flag "${flag.id}" has invalid expiry date "${flag.expiry}"`;
  }
  if (referenceDate.getTime() >= expiry.getTime() + DAY_MS) {
    return `Flag "${flag.id}" expired on ${flag.expiry}`;
  }
  return null;
}

/** Directories never searched, matched by name: dependencies, VCS, build output, coverage. */
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'target',
  'dist',
  'build',
  '.build',
  'coverage',
  '.gradle',
  'DerivedData',
  '.nx',
  'test-results',
  'playwright-report',
]);

/** Every file under `dir` whose path passes `predicate`, skipping ignored directories by name. */
export function findFiles(dir, predicate, results = []) {
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) findFiles(full, predicate, results);
    } else if (predicate(full)) {
      results.push(full);
    }
  }
  return results;
}

const CLIENT_DIRS = ['apps/web', 'apps/ios', 'apps/android', 'packages/core-ts', 'packages/api'];
const SOURCE = /\.(ts|tsx|swift|kt)$/;
/** Test and generated folders, by name: `tests`, `androidTest`, `TranVotingDemoUITests`, … */
const NOT_APP_DIR = /^(tests?|__tests__|androidTest|generated|Generated|.*Tests)$/;
const TEST_FILE = /\.(test|spec)\.tsx?$|Tests?\.(swift|kt)$/;

function isAppSource(file, rootDir) {
  if (!SOURCE.test(file) || TEST_FILE.test(file)) return false;
  const dirs = relative(rootDir, file).split(sep).slice(0, -1);
  return !dirs.some((dir) => NOT_APP_DIR.test(dir));
}

const withoutComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** The generated accessor of `flag` as it is read in each language. */
function accessorPattern(flag, file) {
  const camel = flag.id.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
  // TypeScript: a property of the generated `FLAGS` or of the `FlagsCatalogue` it reads into.
  if (/\.tsx?$/.test(file)) return new RegExp(`\\.${camel}\\b`);
  return new RegExp(`\\bFlags\\.${camel}\\(`);
}

/** Whether a client reads `flag` through its generated accessor outside tests and generated code. */
export function checkFlagUsage(flag, rootDir) {
  for (const dir of CLIENT_DIRS) {
    const files = findFiles(join(rootDir, dir), (file) => isAppSource(file, rootDir));
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      if (content.slice(0, 400).includes('@generated')) continue;
      if (accessorPattern(flag, file).test(withoutComments(content))) return true;
    }
  }
  return false;
}

const isRuleFile = (data) =>
  data !== null &&
  typeof data === 'object' &&
  data.flags !== null &&
  typeof data.flags === 'object' &&
  !Array.isArray(data.flags) &&
  Object.values(data.flags).every(Array.isArray);

/** Rule files anywhere in the repository that name a flag not in `declaredFlagIds`. */
export function checkRuleFiles(declaredFlagIds, rootDir) {
  const problems = [];
  for (const file of findFiles(rootDir, (f) => f.endsWith('.json'))) {
    let data;
    try {
      data = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      continue;
    }
    if (!isRuleFile(data)) continue;
    const name = relative(rootDir, file).split(sep).join('/');
    for (const flagId of Object.keys(data.flags)) {
      if (!declaredFlagIds.has(flagId)) {
        problems.push(`Rule file "${name}" names unknown flag "${flagId}"`);
      }
    }
  }
  return problems;
}

export function runChecks({ rootDir = process.cwd(), referenceDate = new Date() } = {}) {
  const fixturePath = join(rootDir, 'fixtures/flags.json');
  if (!existsSync(fixturePath)) {
    return [`Flags fixture not found at ${fixturePath}`];
  }
  const flags = JSON.parse(readFileSync(fixturePath, 'utf8')).flags ?? [];
  const problems = [];
  for (const flag of flags) {
    if (!isSafeFlagId(flag.id)) {
      problems.push(`Flag "${flag.id}" looks like a secret (REQ-CFG-010)`);
    }
    const expiryError = checkFlagExpiry(flag, referenceDate);
    if (expiryError) problems.push(expiryError);
    if (!checkFlagUsage(flag, rootDir)) {
      problems.push(`Declared flag "${flag.id}" is read by no client (REQ-CFG-009)`);
    }
  }
  problems.push(...checkRuleFiles(new Set(flags.map((f) => f.id)), rootDir));
  return problems;
}

/** `--root <dir>` and `--today YYYY-MM-DD`; both default to the real repository and date. */
export function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    const [name, value] = [argv[i], argv[i + 1]];
    if (name === '--root') {
      options.rootDir = value;
    } else if (name === '--today') {
      const date = new Date(`${value}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '') || isNaN(date.getTime())) {
        throw new Error(`--today takes YYYY-MM-DD, got "${value}"`);
      }
      options.referenceDate = date;
    } else {
      throw new Error(`unknown argument "${name}"`);
    }
  }
  return options;
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  const problems = runChecks(parseArgs(process.argv.slice(2)));
  if (problems.length > 0) {
    console.error('flags:check failed:\n  ' + problems.join('\n  '));
    process.exit(1);
  }
  console.log('flags:check passed (catalogue, expiry, usage, safety and rule files verified)');
}
