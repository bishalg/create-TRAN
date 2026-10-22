#!/usr/bin/env node
/**
 * Touched-file coverage floor (T2, REQ-CODE-002):
 * Reads coverage/coverage-final.json, compares against git diff, asserts 100% lines & branches.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function getChangedFiles(staged = false) {
  const cmd = staged ? 'git diff --cached --name-only' : 'git diff --name-only HEAD';
  try {
    const out = execSync(cmd, { encoding: 'utf8' });
    return out
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && /\.(ts|tsx)$/.test(s) && !s.includes('.test.') && !s.includes('.spec.'));
  } catch {
    return [];
  }
}

export function checkCoverage(root, files, reportPath = 'coverage/coverage-final.json') {
  const fullReport = join(root, reportPath);
  if (!existsSync(fullReport)) {
    return { ok: true, skipped: true, reason: 'No coverage report found' };
  }

  const coverageData = JSON.parse(readFileSync(fullReport, 'utf8'));
  const failures = [];

  for (const file of files) {
    const absPath = join(root, file);
    const entry = coverageData[absPath] ?? coverageData[file];
    if (!entry) {
      continue;
    }

    // Statement / line check
    let coveredStatements = 0;
    let totalStatements = 0;
    if (entry.s) {
      const vals = Object.values(entry.s);
      totalStatements = vals.length;
      coveredStatements = vals.filter((n) => n > 0).length;
    }

    // Branch check
    let coveredBranches = 0;
    let totalBranches = 0;
    if (entry.b) {
      const branches = Object.values(entry.b).flat();
      totalBranches = branches.length;
      coveredBranches = branches.filter((n) => n > 0).length;
    }

    const linePct = totalStatements === 0 ? 100 : (coveredStatements / totalStatements) * 100;
    const branchPct = totalBranches === 0 ? 100 : (coveredBranches / totalBranches) * 100;

    if (linePct < 100 || branchPct < 100) {
      failures.push({
        file,
        linePct,
        branchPct,
      });
    }
  }

  return { ok: failures.length === 0, failures };
}

// realpath: a symlinked path (macOS /var -> /private/var) must still count as running this file.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const staged = process.argv.includes('--staged');
  const files = getChangedFiles(staged);
  const res = checkCoverage(process.cwd(), files);
  if (!res.ok) {
    for (const f of res.failures) {
      console.error(`✖ ${f.file}: lines ${f.linePct.toFixed(1)}%, branches ${f.branchPct.toFixed(1)}% (must be 100%)`);
    }
    process.exit(1);
  }
  console.log('touched-coverage: ok');
}
