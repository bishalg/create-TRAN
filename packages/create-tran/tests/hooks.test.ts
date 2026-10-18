// Verifies: REQ-HOOK-001 REQ-HOOK-002 REQ-HOOK-003
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Git Quality Hooks', () => {
  const workspaceRoot = path.resolve(__dirname, '../../..');
  const preCommitPath = path.join(workspaceRoot, '.githooks', 'pre-commit');
  const prePushPath = path.join(workspaceRoot, '.githooks', 'pre-push');
  const packageJsonPath = path.join(workspaceRoot, 'package.json');

  it('[REQ-HOOK-001] provides pre-commit hook with spec-check, format, typecheck, and clippy gates', () => {
    expect(fs.existsSync(preCommitPath)).toBe(true);
    const content = fs.readFileSync(preCommitPath, 'utf-8');

    // Cites the requirement
    expect(content).toContain('REQ-HOOK-001');

    // Checks required quality gates
    expect(content).toContain('pnpm run spec:check');
    expect(content).toContain('pnpm run format:check');
    expect(content).toContain('cargo fmt --all -- --check');
    expect(content).toContain('pnpm run typecheck');
    expect(content).toContain('cargo clippy --workspace --all-targets -- -D warnings');

    // Valid bash syntax
    expect(() => {
      execFileSync('bash', ['-n', preCommitPath]);
    }).not.toThrow();
  });

  it('[REQ-HOOK-002] provides pre-push hook running workspace unit tests', () => {
    expect(fs.existsSync(prePushPath)).toBe(true);
    const content = fs.readFileSync(prePushPath, 'utf-8');

    // Cites the requirement
    expect(content).toContain('REQ-HOOK-002');

    // Invokes tests
    expect(content).toContain('pnpm run test');

    // Valid bash syntax
    expect(() => {
      execFileSync('bash', ['-n', prePushPath]);
    }).not.toThrow();
  });

  it('[REQ-HOOK-003] configures zero-dependency hooks installation via core.hooksPath in package.json', () => {
    expect(fs.existsSync(packageJsonPath)).toBe(true);
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

    expect(pkg.scripts).toBeDefined();
    expect(pkg.scripts['prepare']).toContain('git config core.hooksPath .githooks');
    expect(pkg.scripts['hooks:install']).toContain('git config core.hooksPath .githooks');
    expect(pkg.scripts['check:quick']).toBeDefined();
  });
});
