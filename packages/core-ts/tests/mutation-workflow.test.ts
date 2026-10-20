// Verifies: REQ-ROB-012
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

describe('nightly mutation gate (REQ-ROB-012)', () => {
  const workflow = read('.github/workflows/mutation.yml');

  it('runs on a schedule and on dispatch, never on pull requests', () => {
    expect(workflow).toMatch(/^on:\n {2}workflow_dispatch:/m);
    expect(workflow).toMatch(/cron: '[^']+'/);
    expect(workflow).not.toMatch(/^ {2}(pull_request|push):/m);
  });

  it('pins every action to a commit SHA and gives every job a timeout', () => {
    const refs = [...workflow.matchAll(/uses: (\S+)/g)].map(([, ref]) => ref ?? '');
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(ref).toMatch(/@[0-9a-f]{40}$/);
    const jobs = workflow.split(/^jobs:$/m)[1]?.match(/^ {2}[a-z-]+:$/gm) ?? [];
    expect(jobs.map((j) => j.trim())).toEqual(['rust:', 'typescript:']);
    expect(workflow.match(/^ {4}timeout-minutes: \d+$/gm) ?? []).toHaveLength(jobs.length);
  });

  it('mutates the Rust core and API, and the TypeScript core', () => {
    expect(workflow).toContain('cargo mutants -p rust-core -p api -p tran-tokens-codegen');
    expect(workflow).toContain('pnpm --filter @tran/core mutation');
    expect(existsSync(new URL('../../../.cargo/mutants.toml', import.meta.url))).toBe(true);
  });

  it('keeps the Stryker break threshold at or above the recorded baseline', () => {
    const config = JSON.parse(read('packages/core-ts/stryker.config.json'));
    expect(config.thresholds.break).toBeGreaterThanOrEqual(95);
    expect(config.mutate).toContain('!src/generated/**');
  });
});
