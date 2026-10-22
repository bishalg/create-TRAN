// Verifies: REQ-AGT-007, REQ-AGT-008
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  branchName,
  globToRegExp,
  guardChanges,
  openPrsFor,
  parseNumstat,
  runTask,
  taskFromBranch,
} from './agents.mjs';
import { POLICY, task, edited, REVIEW, fakeIo, OPTS } from './test-helpers.mjs';

describe('guard (REQ-AGT-007)', () => {
  it('matches prefixes, any-depth names and single-segment stars', () => {
    assert.ok(globToRegExp('docs/specs/').test('docs/specs/015-agents.md'));
    assert.ok(!globToRegExp('docs/specs/').test('docs/specs.md'));
    assert.ok(globToRegExp('**/package.json').test('package.json'));
    assert.ok(globToRegExp('**/package.json').test('apps/web/package.json'));
    assert.ok(globToRegExp('**/generated/').test('packages/core-ts/src/generated/rules.ts'));
    assert.ok(globToRegExp('**/*.gradle.kts').test('apps/android/app/build.gradle.kts'));
    assert.ok(!globToRegExp('Cargo.lock').test('crates/Cargo.lock'));
  });

  it('passes a change inside scope and budget', () => {
    assert.deepEqual(
      guardChanges([{ path: 'crates/rust-core/src/lib.rs', lines: 20 }], task(), POLICY),
      []
    );
  });

  it('fails a file outside scope, a protected file, and a change over budget', () => {
    const errors = guardChanges(
      [
        { path: 'apps/web/src/main.tsx', lines: 10 },
        { path: 'crates/rust-core/Cargo.toml', lines: 2 },
        { path: 'docs/specs/001-eligibility-rules.md', lines: 40 },
      ],
      task(),
      POLICY
    );
    assert.deepEqual(errors, [
      "apps/web/src/main.tsx: outside the task's scope (docs/specs/, crates/)",
      'crates/rust-core/Cargo.toml: protected by .agents/policy.json',
      '52 changed lines, over the budget of 50',
    ]);
  });

  it('a task may allow a protected path; it can never allow its own rules', () => {
    const allowing = edited({ 'max_changed_lines: 50': "allow: ['**/Cargo.toml']" });
    assert.deepEqual(
      guardChanges([{ path: 'crates/rust-core/Cargo.toml', lines: 2 }], allowing, POLICY),
      []
    );
    assert.ok(POLICY.protected.includes('.agents/'), 'task files and the policy are protected');
    assert.ok(POLICY.protected.includes('.github/'), 'workflows are protected');
  });

  it('a read-only task may change nothing', () => {
    assert.deepEqual(guardChanges([], REVIEW, POLICY), []);
    assert.deepEqual(guardChanges([{ path: 'a.ts', lines: 1 }], REVIEW, POLICY), [
      'a read-only task changed files: a.ts',
    ]);
  });

  it('counts changed lines from numstat, a binary file as one', () => {
    assert.deepEqual(parseNumstat('3\t1\ta.ts\n-\t-\tlogo.png\n0\t0\tempty.txt\n'), [
      { path: 'a.ts', lines: 4 },
      { path: 'logo.png', lines: 1 },
      { path: 'empty.txt', lines: 1 },
    ]);
  });
});

describe('branches and open pull requests (REQ-AGT-008)', () => {
  const names = ['spec-gap', 'spec-gap-native', 'code-review'];

  it('names a branch after the task and the time, and reads the task back', () => {
    const branch = branchName('spec-gap', 'agent/', new Date('2026-10-21T05:17:42Z'));
    assert.equal(branch, 'agent/spec-gap-20261021-051742');
    assert.equal(taskFromBranch(branch, 'agent/', names), 'spec-gap');
    assert.equal(
      taskFromBranch('agent/spec-gap-native-20261021-0517', 'agent/', names),
      'spec-gap-native'
    );
    assert.equal(taskFromBranch('feat/spec-gap', 'agent/', names), null);
    assert.equal(taskFromBranch('agent/unknown-1', 'agent/', names), null);
  });

  it('finds only the open pull requests of this task', () => {
    const prs = [
      { headRefName: 'agent/spec-gap-20261014-0517', url: 'u1' },
      { headRefName: 'agent/spec-gap-native-20261014-0517', url: 'u2' },
      { headRefName: 'feat/x', url: 'u3' },
    ];
    assert.deepEqual(
      openPrsFor('spec-gap', 'agent/', prs, names).map((p) => p.url),
      ['u1']
    );
  });

  it('skips a task that already has an open pull request', () => {
    const io = fakeIo({
      openPrs: [{ headRefName: 'agent/spec-gap-20261014-0517', url: 'https://x/pr/9' }],
    });
    const result = runTask(task(), { ...OPTS, publish: true }, io);
    assert.equal(result.outcome, 'skipped');
    assert.match(result.message, /pr\/9/);
    assert.equal(io.calls.harness, 0);
  });

  it('continues, with a note, when open pull requests cannot be listed', () => {
    const io = fakeIo({
      openPrs: null,
      handoff: 'feat: x\n\nWhat',
      changes: [{ path: 'crates/a.rs', lines: 3 }],
    });
    assert.equal(runTask(task(), { ...OPTS, publish: true }, io).outcome, 'published');
    assert.match(io.logs.join('\n'), /could not list open pull requests/);
  });
});
