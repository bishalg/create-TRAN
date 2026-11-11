// Verifies: REQ-SUP-001, REQ-SUP-002, REQ-SUP-003, REQ-SUP-004, REQ-MOB-001, REQ-DEP-001
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  checkAll,
  dependabotEcosystems,
  dockerRust,
  dockerRustProblems,
  olderThan,
  openEndedOverrides,
  requiredRust,
  requiredEcosystems,
  securityProblems,
  unexplainedIgnores,
  unpinnedActions,
  unpinnedDockerImages,
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

  it('REQ-MOB-001 a Gemfile (fastlane) needs the bundler ecosystem', () => {
    const files = new Set(['package.json', 'Gemfile']);
    assert.deepEqual(
      requiredEcosystems((p) => files.has(p)),
      ['npm', 'bundler']
    );
    const errors = checkAll(ROOT);
    assert.deepEqual(errors, []);
    assert.match(
      dependabotEcosystems(
        '  - package-ecosystem: npm\n  - package-ecosystem: bundler # fastlane\n'
      ).join(),
      /bundler/
    );
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

describe('Dockerfile base images are pinned by digest (REQ-DEP-001)', () => {
  it('accepts base images with sha256 digest and rejects unpinned tags or bare names', () => {
    const sha = 'a'.repeat(64);
    assert.deepEqual(
      unpinnedDockerImages(
        `FROM rust:1.85-alpine@sha256:${sha} AS builder\nFROM alpine:3.21@sha256:${sha}\nFROM scratch\n`
      ),
      []
    );
    assert.deepEqual(unpinnedDockerImages('FROM rust:1.85-alpine AS builder\nFROM alpine:3.21\n'), [
      'line 1: rust:1.85-alpine is not pinned to a digest (image@sha256:...)',
      'line 2: alpine:3.21 is not pinned to a digest (image@sha256:...)',
    ]);
  });
});

describe("the image's Rust is new enough for the locked dependencies (REQ-DEP-001)", () => {
  const pkg = (name, version, rust, source = 'registry') => ({
    id: `${name} ${version}`,
    name,
    version,
    rust_version: rust,
    source: source === null ? null : source,
  });
  const metadata = {
    packages: [
      pkg('api', '0.1.0', null, null),
      pkg('rusqlite', '0.41.1', '1.89.0'),
      pkg('sha2', '0.11.1', '1.88'),
      pkg('loom', '0.7.0', '1.95'),
    ],
    resolve: {
      nodes: [
        {
          id: 'api 0.1.0',
          deps: [
            { pkg: 'rusqlite 0.41.1', dep_kinds: [{ kind: null }] },
            { pkg: 'loom 0.7.0', dep_kinds: [{ kind: 'dev' }] },
          ],
        },
        { id: 'rusqlite 0.41.1', deps: [{ pkg: 'sha2 0.11.1', dep_kinds: [{ kind: 'build' }] }] },
        { id: 'sha2 0.11.1', deps: [] },
        { id: 'loom 0.7.0', deps: [] },
      ],
    },
  };

  it('REQ-DEP-001 the newest rust-version among normal and build dependencies, not dev ones', () => {
    assert.deepEqual(requiredRust(metadata), { version: '1.89.0', by: 'rusqlite@0.41.1' });
    assert.throws(() => requiredRust(metadata, 'web'), /no workspace package "web"/);
  });

  it('REQ-DEP-001 compares versions numerically, with missing parts as 0', () => {
    assert.equal(olderThan('1.85', '1.89.0'), true);
    assert.equal(olderThan('1.100.0', '1.99'), false);
    assert.equal(olderThan('1.89', '1.89.0'), false);
  });

  it('REQ-DEP-001 an older builder fails; the same or newer passes', () => {
    const required = requiredRust(metadata);
    const from = (tag) => `FROM rust:${tag}@sha256:${'a'.repeat(64)} AS builder\nFROM scratch\n`;
    assert.equal(dockerRust(from('1.99.1-alpine3.24')), '1.99.1');
    assert.deepEqual(dockerRustProblems(from('1.85-alpine3.21'), required), [
      'rust:1.85 is older than 1.89.0, which rusqlite@0.41.1 requires',
    ]);
    assert.deepEqual(dockerRustProblems(from('1.89-alpine'), required), []);
    assert.deepEqual(dockerRustProblems('FROM alpine:3.21\n', required), [
      'no rust:<version> base image to build the API with',
    ]);
  });
});

describe('this repository', () => {
  it('passes every check', () => {
    assert.deepEqual(checkAll(ROOT), []);
  });
});
