#!/usr/bin/env node
/**
 * Feature flag checks (spec 029 REQ-CFG-009, REQ-CFG-010).
 *
 * Checks:
 * 1. Stale flags: fails when a flag is past its expiry date (REQ-CFG-009).
 * 2. Unused flags: fails when a declared flag is read by no client (REQ-CFG-009).
 * 3. Unknown flags: fails when a rule file in the repo names a flag that is not declared (REQ-CFG-009).
 * 4. Safe names: fails on a flag whose name looks like a secret (REQ-CFG-010).
 *
 * Usage:
 *   node tooling/flags/flags.mjs
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
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

export function checkFlagExpiry(flag, referenceDate = new Date()) {
  const expiry = new Date(`${flag.expiry}T00:00:00Z`);
  if (isNaN(expiry.getTime())) {
    return `Flag "${flag.id}" has invalid expiry date "${flag.expiry}"`;
  }
  if (expiry < referenceDate) {
    return `Flag "${flag.id}" expired on ${flag.expiry}`;
  }
  return null;
}

export function findFiles(dir, predicate, results = []) {
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir)) {
    if (
      entry === 'node_modules' ||
      entry === '.git' ||
      entry === 'target' ||
      entry === 'dist' ||
      entry === '.build'
    ) {
      continue;
    }
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      findFiles(full, predicate, results);
    } else if (predicate(full)) {
      results.push(full);
    }
  }
  return results;
}

export function checkFlagUsage(flag, rootDir) {
  const clientDirs = [
    join(rootDir, 'apps/web'),
    join(rootDir, 'apps/ios'),
    join(rootDir, 'apps/android'),
    join(rootDir, 'packages/api'),
    join(rootDir, 'packages/core-ts'),
  ];

  const searchPatterns = [
    flag.id,
    flag.id.replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
    `FLAG_${flag.id.toUpperCase()}`,
  ];

  for (const dir of clientDirs) {
    const files = findFiles(dir, (f) => /\.(ts|tsx|swift|kt)$/.test(f));
    for (const file of files) {
      if (
        file.includes('Generated/Flags') ||
        file.includes('generated/Flags') ||
        file.includes('generated/flags') ||
        file.includes('packages/core-ts/src/flags.ts')
      ) {
        continue;
      }
      const content = readFileSync(file, 'utf8');
      if (searchPatterns.some((pattern) => content.includes(pattern))) {
        return true;
      }
    }
  }
  return false;
}

export function checkRuleFiles(declaredFlagIds, rootDir) {
  const problems = [];
  const jsonFiles = findFiles(rootDir, (f) => f.endsWith('.json'));
  for (const file of jsonFiles) {
    if (
      file.includes('node_modules') ||
      file.includes('target') ||
      file.includes('dist') ||
      file.includes('package.json') ||
      file.includes('tsconfig') ||
      file.includes('fixtures/flags.json')
    ) {
      continue;
    }
    try {
      const data = JSON.parse(readFileSync(file, 'utf8'));
      if (
        data &&
        typeof data === 'object' &&
        data.flags &&
        typeof data.flags === 'object' &&
        !Array.isArray(data.flags)
      ) {
        for (const flagId of Object.keys(data.flags)) {
          if (!declaredFlagIds.has(flagId)) {
            problems.push(`Rule file "${file}" names unknown flag "${flagId}"`);
          }
        }
      }
    } catch {
      // Not a rule json file
    }
  }
  return problems;
}

export function runChecks({ rootDir = process.cwd(), referenceDate = new Date() } = {}) {
  const fixturePath = join(rootDir, 'fixtures/flags.json');
  if (!existsSync(fixturePath)) {
    return [`Flags fixture not found at ${fixturePath}`];
  }
  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const flags = fixture.flags || [];
  const declaredIds = new Set(flags.map((f) => f.id));
  const problems = [];

  for (const flag of flags) {
    if (!isSafeFlagId(flag.id)) {
      problems.push(`Flag "${flag.id}" looks like a secret (REQ-CFG-010)`);
    }

    const expiryError = checkFlagExpiry(flag, referenceDate);
    if (expiryError) {
      problems.push(expiryError);
    }

    const isUsed = checkFlagUsage(flag, rootDir);
    if (!isUsed) {
      problems.push(`Declared flag "${flag.id}" is read by no client (REQ-CFG-009)`);
    }
  }

  const ruleProblems = checkRuleFiles(declaredIds, rootDir);
  problems.push(...ruleProblems);

  return problems;
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  const problems = runChecks();
  if (problems.length > 0) {
    console.error('flags:check failed:\n  ' + problems.join('\n  '));
    process.exit(1);
  }
  console.log('flags:check passed (catalogue, expiry, safety and rule files verified)');
}
