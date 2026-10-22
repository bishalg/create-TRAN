#!/usr/bin/env node
/**
 * Fake-fallback gate (T1, REQ-CODE-001): bans invented defaults (?? 0, || 0 on coordinates/time,
 * literal timezones, unwrap_or_default() on rule inputs).
 */
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PATTERNS = [
  {
    id: 'zero-fallback-variable',
    re: /\b(lat|latitude|lon|longitude|age|birthTime|birth_time|time|lagna)\s*(\?\?|\|\|)\s*0\b/i,
    message: 'Invented default zero on coordinates, age, or time parameter: return a typed missing error instead.',
  },
  {
    id: 'literal-timezone',
    re: /(["'])(Asia\/Kathmandu|Asia\/Kolkata|UTC|GMT)\1/g,
    message: 'Literal default timezone: timezones must be provided explicitly by user/profile.',
  },
  {
    id: 'rust-rule-unwrap-default',
    re: /\.unwrap_or_default\(\)/g,
    message: 'unwrap_or_default() in rules core: handle missing values explicitly.',
    pathFilter: (p) => p.includes('crates/rust-core/src'),
  },
];

export const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'target',
  '.nx',
  'coverage',
  'fixtures',
]);

export function scanSource(filePath, content, allowList = {}) {
  const violations = [];
  const lines = content.split('\n');

  lines.forEach((line, idx) => {
    // Skip comments
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
      return;
    }

    for (const pat of PATTERNS) {
      if (pat.pathFilter && !pat.pathFilter(filePath)) {
        continue;
      }
      if (pat.re.test(line)) {
        const allowEntry = allowList[filePath];
        if (allowEntry && allowEntry.includes(pat.id)) {
          continue;
        }
        violations.push({
          file: filePath,
          line: idx + 1,
          patternId: pat.id,
          message: pat.message,
        });
      }
    }
  });

  return violations;
}

export function walkDir(dir, root = dir) {
  const files = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDir(full, root));
    } else if (/\.(ts|tsx|rs|mjs)$/.test(entry.name) && !entry.name.endsWith('.test.mjs') && !entry.name.endsWith('.spec.ts')) {
      files.push(full.slice(root.length + 1));
    }
  }
  return files;
}

export function checkFallbacks(root) {
  const allowPath = join(root, 'tooling/fallback-gate/allowlist.json');
  const allowList = existsSync(allowPath) ? JSON.parse(readFileSync(allowPath, 'utf8')) : {};
  const files = walkDir(root);
  const violations = [];

  for (const file of files) {
    if (file.includes('tooling/fallback-gate')) continue;
    const full = join(root, file);
    const content = readFileSync(full, 'utf8');
    violations.push(...scanSource(file, content, allowList));
  }

  return violations;
}

// realpath: a symlinked path (macOS /var -> /private/var) must still count as running this file.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const violations = checkFallbacks(process.cwd());
  for (const v of violations) {
    console.error(`✖ ${v.file}:${v.line} [${v.patternId}] ${v.message}`);
  }
  if (violations.length > 0) {
    process.exit(1);
  }
  console.log('fallback:check: ok');
}
