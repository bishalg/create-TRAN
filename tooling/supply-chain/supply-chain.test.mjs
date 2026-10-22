// Verifies: REQ-SUP-001, REQ-SUP-002, REQ-SUP-003, REQ-SUP-004
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  checkAll,
  dependabotEcosystems,
  openEndedOverrides,
  requiredEcosystems,
  securityProblems,
  unexplainedIgnores,
  unpinnedActions,
} from './supply-chain.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

describe('actions are pinned by commit (REQ-SUP-003)', () => {
  it('accepts a SHA with a version comment and rejects tags, branches and bare SHAs', () => {
    const sha = 'a'.repeat(40);
    assert.deepEqual(
      unpinnedActions(`steps:\n  - uses: actions/checkout@${sha} # v4\n  - uses: ./local\n`),
      []
    );
    assert.deepEqual(unpinnedActions('  - uses: actions/checkout@v4\n'), [
      'line 1: actions/checkout@v4 is not pinned to a commit SHA',
    ]);
    assert.deepEqual(unpinnedActions('  - uses: dtolnay/rust-toolchain@stable\n'), [
      'line 1: dtolnay/rust-toolchain@stable is not pinned to a commit SHA',
    ]);
    assert.deepEqual(unpinnedActions(`        uses: x/y@${sha}\n`), [
      `line 1: x/y@${sha} has no version comment`,
    ]);
  });
});

describe('Dependabot covers every ecosystem (REQ-SUP-002)', () => {
  it('derives the ecosystems from the files present', () => {
    const files = new Set(['package.json', 'Cargo.toml', '.github/workflows']);
    assert.deepEqual(
      requiredEcosystems((p) => files.has(p)),
      ['npm', 'cargo', 'github-actions']
    );
    files.add('apps/android/build.gradle.kts');
    assert.ok(requiredEcosystems((p) => files.has(p)).includes('gradle'));
  });

  it('reads the ecosystems a dependabot.yml names', () => {
    assert.deepEqual(
      dependabotEcosystems(
        'version: 2\nupdates:\n  - package-ecosystem: npm\n    directory: /\n  - package-ecosystem: github-actions\n'
      ),
      ['npm', 'github-actions']
    );
  });
});

describe('overrides expire on their own (REQ-SUP-001)', () => {
  it('flags an override keyed by bare name', () => {
    const yaml =
      "packages:\n  - 'apps/*'\n\noverrides:\n  'undici@>=7 <7.29.1': '>=7.29.1'\n  qs: '>=6.16.0'\n  'tinypool@<2.1.2': '>=2.1.2'\n";
    assert.deepEqual(openEndedOverrides(yaml), ['qs']);
    assert.deepEqual(openEndedOverrides('packages:\n  - e2e\n'), []);
  });
});

describe('ignored Rust advisories carry a reason (REQ-SUP-001)', () => {
  it('accepts a comment above each id, in a one-line or multi-line list', () => {
    assert.deepEqual(
      unexplainedIgnores(
        '[advisories]\n# basic-toml: build-time only\nignore = ["RUSTSEC-2026-0374"]\n'
      ),
      []
    );
    assert.deepEqual(
      unexplainedIgnores(
        '[advisories]\nignore = [\n  # reason one\n  "RUSTSEC-1",\n  "RUSTSEC-2",\n]\n'
      ),
      ['RUSTSEC-2']
    );
  });

  it('flags an id with no comment, and accepts a file with no ignores', () => {
    assert.deepEqual(unexplainedIgnores('[advisories]\nignore = ["RUSTSEC-9"]\n'), ['RUSTSEC-9']);
    assert.deepEqual(unexplainedIgnores('[advisories]\n'), []);
  });
});

describe('SECURITY.md (REQ-SUP-004)', () => {
  it('needs the reporting and supported-versions sections', () => {
    assert.deepEqual(
      securityProblems('# Security\n\n## Reporting a vulnerability\n\n## Supported versions\n'),
      []
    );
    assert.deepEqual(securityProblems('# Security\n'), [
      'SECURITY.md: missing section "## Reporting a vulnerability"',
      'SECURITY.md: missing section "## Supported versions"',
    ]);
  });
});

describe('this repository', () => {
  it('passes every check', () => {
    assert.deepEqual(checkAll(ROOT), []);
  });
});
