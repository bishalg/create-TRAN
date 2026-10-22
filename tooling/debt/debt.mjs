#!/usr/bin/env node
/**
 * Debt ratchet for create-TRAN (T3, REQ-CODE-003):
 * Counts `as unknown as`, `eslint-disable`, and `#[allow(`. Baselines can only decrease.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { measureDebt } from './debt-metrics.mjs';

const BASELINE_PATH = 'tooling/debt/baseline.json';

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'target',
  '.nx',
  'coverage',
]);

export function scanFiles(dir, root = dir) {
  const files = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...scanFiles(full, root));
    } else if (/\.(ts|tsx|rs)$/.test(entry.name) && !entry.name.includes('.test.') && !entry.name.includes('.spec.')) {
      files.push(full.slice(root.length + 1));
    }
  }
  return files;
}

export function collectDebt(root) {
  const files = scanFiles(root);
  const fileDebts = {};
  const totals = { asUnknownAs: 0, eslintDisable: 0, allowAttr: 0 };

  for (const file of files) {
    const content = readFileSync(join(root, file), 'utf8');
    const m = measureDebt(content);
    if (Object.keys(m).length > 0) {
      fileDebts[file] = m;
      for (const [k, v] of Object.entries(m)) {
        totals[k] = (totals[k] ?? 0) + v;
      }
    }
  }

  return { totals, files: fileDebts };
}

export function checkRatchet(root) {
  const current = collectDebt(root);
  const baselineFile = join(root, BASELINE_PATH);

  if (!existsSync(baselineFile)) {
    // Seed baseline
    writeFileSync(baselineFile, JSON.stringify(current, null, 2) + '\n');
    return { ok: true, seeded: true, current };
  }

  const baseline = JSON.parse(readFileSync(baselineFile, 'utf8'));
  const increases = [];
  let shrunk = false;

  for (const [metric, count] of Object.entries(current.totals)) {
    const baseCount = baseline.totals[metric] ?? 0;
    if (count > baseCount) {
      increases.push({ metric, baseline: baseCount, current: count });
    } else if (count < baseCount) {
      shrunk = true;
    }
  }

  if (increases.length > 0) {
    return { ok: false, increases, current, baseline };
  }

  if (shrunk) {
    // Auto-shrink baseline
    writeFileSync(baselineFile, JSON.stringify(current, null, 2) + '\n');
    return { ok: true, shrunk: true, current };
  }

  return { ok: true, current };
}

// realpath: a symlinked path (macOS /var -> /private/var) must still count as running this file.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const res = checkRatchet(process.cwd());
  if (!res.ok) {
    for (const inc of res.increases) {
      console.error(`✖ debt ratchet increased for ${inc.metric}: baseline was ${inc.baseline}, now ${inc.current}`);
    }
    process.exit(1);
  }
  if (res.seeded) {
    console.log('debt:check: baseline seeded');
  } else if (res.shrunk) {
    console.log('debt:check: baseline shrunk to lower debt');
  } else {
    console.log('debt:check: ok');
  }
}
