// Verifies: REQ-REL-001, REQ-REL-002, REQ-REL-003, REQ-REL-004
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import {
  buildNumber,
  changelogSection,
  checkVersions,
  lintCommitMessage,
  nextVersion,
  notesFor,
  parseCommit,
  prependChangelog,
  readVersions,
  setVersion,
  versionFiles,
} from './release.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** The version files of a tiny workspace, as `versionFiles` would find them. */
function fixture(version = '1.2.3', build = buildNumber('1.2.3')) {
  return new Map([
    ['package.json', `{\n  "name": "x",\n  "version": "${version}"\n}\n`],
    ['packages/a/package.json', `{\n  "name": "@x/a",\n  "version": "${version}"\n}\n`],
    [
      'Cargo.toml',
      `[workspace]\nmembers = []\n\n[workspace.package]\nversion = "${version}"\nedition = "2021"\n\n[workspace.dependencies]\nserde = { version = "1.0" }\n`,
    ],
    [
      'apps/ios/project.yml',
      `settings:\n  base:\n    MARKETING_VERSION: '${version}'\n    CURRENT_PROJECT_VERSION: '${build}'\n`,
    ],
    [
      'apps/android/app/build.gradle.kts',
      `android {\n    defaultConfig {\n        versionCode = ${build}\n        versionName = "${version}"\n    }\n}\n`,
    ],
  ]);
}

describe('one version everywhere (REQ-REL-001)', () => {
  it('derives an increasing build number from the version', () => {
    assert.equal(buildNumber('0.1.0'), 1_000);
    assert.equal(buildNumber('1.2.3'), 1_002_003);
    assert.ok(buildNumber('1.10.0') > buildNumber('1.9.999'));
    assert.throws(() => buildNumber('1.2'), /not a version/);
    assert.throws(() => buildNumber('1.1000.0'), /below 1000/);
  });

  it('reads every version field and finds no problem when they agree', () => {
    const files = fixture();
    assert.deepEqual(readVersions(files), [
      { file: 'package.json', field: 'version', value: '1.2.3' },
      { file: 'packages/a/package.json', field: 'version', value: '1.2.3' },
      { file: 'Cargo.toml', field: 'workspace.package.version', value: '1.2.3' },
      { file: 'apps/ios/project.yml', field: 'MARKETING_VERSION', value: '1.2.3' },
      { file: 'apps/ios/project.yml', field: 'CURRENT_PROJECT_VERSION', value: '1002003' },
      { file: 'apps/android/app/build.gradle.kts', field: 'versionName', value: '1.2.3' },
      { file: 'apps/android/app/build.gradle.kts', field: 'versionCode', value: '1002003' },
    ]);
    assert.deepEqual(checkVersions(files), []);
  });

  it('reports a hand-edited version, a stale build number and a wrong tag', () => {
    const files = fixture();
    files.set('packages/a/package.json', '{\n  "version": "1.2.4"\n}\n');
    files.set('apps/android/app/build.gradle.kts', 'versionCode = 1\nversionName = "1.2.3"\n');
    assert.deepEqual(checkVersions(files, { tag: 'v1.3.0' }), [
      'packages/a/package.json: version is 1.2.4, expected 1.2.3',
      'apps/android/app/build.gradle.kts: versionCode is 1, expected 1002003',
      'tag v1.3.0 does not match version 1.2.3',
    ]);
  });

  it('reports a version field that is missing', () => {
    const files = fixture();
    files.set('apps/ios/project.yml', 'settings: {}\n');
    assert.deepEqual(checkVersions(files), [
      'apps/ios/project.yml: no MARKETING_VERSION',
      'apps/ios/project.yml: no CURRENT_PROJECT_VERSION',
    ]);
  });

  it('writes a version to every file, leaving dependency versions alone', () => {
    const next = setVersion(fixture(), '2.0.0');
    assert.deepEqual(checkVersions(next), []);
    assert.equal(readVersions(next)[0].value, '2.0.0');
    assert.match(next.get('Cargo.toml'), /serde = \{ version = "1.0" \}/);
    assert.match(next.get('apps/ios/project.yml'), /CURRENT_PROJECT_VERSION: '2000000'/);
  });

  it('checks and writes every occurrence in a generated Xcode project (Debug and Release)', () => {
    const files = fixture();
    const pbx = 'App.xcodeproj/project.pbxproj';
    files.set(
      pbx,
      'CURRENT_PROJECT_VERSION = 1002003;\nMARKETING_VERSION = 1.2.3;\nCURRENT_PROJECT_VERSION = 1;\nMARKETING_VERSION = 1.2.3;\n'
    );
    assert.deepEqual(checkVersions(files), [
      `${pbx}: CURRENT_PROJECT_VERSION is 1, expected 1002003`,
    ]);
    const next = setVersion(files, '1.3.0');
    assert.deepEqual(checkVersions(next), []);
    assert.equal(next.get(pbx).match(/MARKETING_VERSION = 1\.3\.0;/g).length, 2);
  });

  it('checks and writes the workspace crates in Cargo.lock, never a registry crate', () => {
    const files = fixture();
    const lock = (own) =>
      `[[package]]\nname = "serde"\nversion = "1.0.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n\n` +
      `[[package]]\nname = "api"\nversion = "${own}"\ndependencies = [\n "serde",\n]\n\n` +
      `[[package]]\nname = "core"\nversion = "1.2.3"\n`;
    files.set('Cargo.lock', lock('1.2.2'));
    assert.deepEqual(checkVersions(files), [
      'Cargo.lock: workspace crate version is 1.2.2, expected 1.2.3',
    ]);
    const next = setVersion(files, '1.3.0');
    assert.deepEqual(checkVersions(next), []);
    assert.equal(next.get('Cargo.lock').match(/version = "1\.3\.0"/g).length, 2);
    assert.match(next.get('Cargo.lock'), /name = "serde"\nversion = "1\.0\.0"/);
  });

  it('finds the version files of this repository, and they agree', () => {
    const paths = versionFiles(ROOT);
    for (const path of [
      'package.json',
      'Cargo.toml',
      'Cargo.lock',
      'apps/ios/project.yml',
      'apps/ios/TranVotingDemo.xcodeproj/project.pbxproj',
      'packages/core-ts/package.json',
    ]) {
      assert.ok(paths.includes(path), path);
    }
    const files = new Map(paths.map((path) => [path, readFileSync(join(ROOT, path), 'utf8')]));
    assert.deepEqual(checkVersions(files), []);
  });
});

describe('conventional commits (REQ-REL-002)', () => {
  it('parses type, scope, breaking marker and subject', () => {
    assert.deepEqual(parseCommit('feat(api)!: drop v1 route'), {
      type: 'feat',
      scope: 'api',
      breaking: true,
      subject: 'drop v1 route',
    });
    assert.deepEqual(parseCommit('fix: off-by-one', 'BREAKING CHANGE: age is now inclusive'), {
      type: 'fix',
      scope: undefined,
      breaking: true,
      subject: 'off-by-one',
    });
    assert.equal(parseCommit('Update stuff'), undefined);
    assert.equal(parseCommit('feat:no space'), undefined);
  });

  it('is enforced by the commit-msg hook', () => {
    const hook = join(ROOT, '.githooks/commit-msg');
    assert.ok(statSync(hook).mode & 0o111, 'the hook is executable');
    assert.match(readFileSync(hook, 'utf8'), /release\.mjs" lint-commit "\$1"/);
  });

  it('accepts conventional, merge, revert, fixup and squash headers; rejects the rest', () => {
    for (const ok of [
      'feat(web): add a loading state',
      'chore!: drop Node 20',
      'Merge pull request #6 from bishalg/feat/native-atoms',
      'Merge branch dev into main',
      'Revert "feat: x"',
      'fixup! feat: x',
      'squash! fix: y',
      'docs: spec 017\n\nlonger body\n# a comment git strips',
    ]) {
      assert.equal(lintCommitMessage(ok), undefined, ok);
    }
    assert.match(lintCommitMessage('Added stuff'), /type\(scope\)!: subject/);
    assert.match(lintCommitMessage('feature: x'), /type\(scope\)!: subject/);
    assert.match(lintCommitMessage('feat: '), /type\(scope\)!: subject/);
    assert.match(lintCommitMessage('# only a comment\n'), /empty/);
  });
});

describe('version and changelog from history (REQ-REL-003)', () => {
  const c = (header, body = '') => ({ hash: 'abc1234', ...parseCommit(header, body), header });

  it('picks the bump from the commits, with breaking changes held to minor below 1.0', () => {
    assert.equal(nextVersion('1.2.3', [c('fix: a')], 'auto'), '1.2.4');
    assert.equal(nextVersion('1.2.3', [c('fix: a'), c('feat: b')], 'auto'), '1.3.0');
    assert.equal(nextVersion('1.2.3', [c('feat!: b')], 'auto'), '2.0.0');
    assert.equal(nextVersion('0.4.1', [c('feat!: b')], 'auto'), '0.5.0');
    assert.equal(nextVersion('0.4.1', [{ hash: 'x', header: 'Update' }], 'auto'), '0.4.2');
    assert.equal(nextVersion('1.2.3', [], 'major'), '2.0.0');
    assert.equal(nextVersion('1.2.3', [], 'minor'), '1.3.0');
    assert.equal(nextVersion('1.2.3', [], 'patch'), '1.2.4');
    assert.throws(() => nextVersion('1.2.3', [], 'huge'), /auto, patch, minor or major/);
  });

  it('writes a section grouped by kind, breaking first, merges left out', () => {
    const section = changelogSection('1.3.0', '2026-10-22', [
      c('feat(web): loading state'),
      c('fix: off-by-one'),
      c('perf(api): cache rules'),
      c('feat!: drop v1'),
      c('docs: spec 017'),
      { hash: 'def5678', header: 'Merge pull request #7 from x/y' },
      { hash: 'aaa0000', header: 'Update readme' },
    ]);
    assert.equal(
      section,
      [
        '## 1.3.0 - 2026-10-22',
        '',
        '### Breaking changes',
        '',
        '- drop v1 (abc1234)',
        '',
        '### Features',
        '',
        '- **web:** loading state (abc1234)',
        '',
        '### Fixes',
        '',
        '- off-by-one (abc1234)',
        '',
        '### Performance',
        '',
        '- **api:** cache rules (abc1234)',
        '',
        '### Other changes',
        '',
        '- docs: spec 017 (abc1234)',
        '- Update readme (aaa0000)',
        '',
      ].join('\n')
    );
  });

  it('prepends below the title and reads one version’s notes back', () => {
    const empty = '# Changelog\n\nAll notable changes, newest first. Written by `pnpm release`.\n';
    const one = prependChangelog(empty, changelogSection('0.2.0', '2026-10-01', [c('feat: a')]));
    const two = prependChangelog(one, changelogSection('0.3.0', '2026-10-22', [c('fix: b')]));
    assert.ok(two.indexOf('## 0.3.0') < two.indexOf('## 0.2.0'));
    assert.ok(two.startsWith(empty));
    assert.equal(notesFor(two, '0.2.0'), '### Features\n\n- a (abc1234)');
    assert.equal(notesFor(two, 'v0.3.0'), '### Fixes\n\n- b (abc1234)');
    assert.throws(() => notesFor(two, '9.9.9'), /no section for 9.9.9/);
  });

  it('bumps a real repository end to end and refuses a dirty tree or nothing to release', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tran-release-'));
    try {
      const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
      const cli = (...args) =>
        execFileSync('node', [join(ROOT, 'tooling/release/release.mjs'), ...args], {
          cwd: dir,
          encoding: 'utf8',
          stdio: 'pipe',
        });
      git('init', '-q', '-b', 'main');
      git('config', 'user.email', 't@example.com');
      git('config', 'user.name', 't');
      writeFileSync(join(dir, 'package.json'), '{\n  "version": "0.1.0"\n}\n');
      writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n');
      git('add', '.');
      git('commit', '-q', '-m', 'chore: start');
      git('tag', 'v0.1.0');
      assert.throws(() => cli('bump', 'auto'), /no commits since v0.1.0/);
      writeFileSync(join(dir, 'a.txt'), 'a');
      git('add', '.');
      git('commit', '-q', '-m', 'feat(web): add a');
      writeFileSync(join(dir, 'b.txt'), 'dirty');
      assert.throws(() => cli('bump', 'auto'), /uncommitted changes/);
      rmSync(join(dir, 'b.txt'));
      const out = cli('bump', 'auto', '--date', '2026-10-22');
      assert.match(out, /0\.1\.0 -> 0\.2\.0/);
      assert.match(out, /git tag v0\.2\.0/);
      assert.match(readFileSync(join(dir, 'package.json'), 'utf8'), /"version": "0.2.0"/);
      assert.match(
        readFileSync(join(dir, 'CHANGELOG.md'), 'utf8'),
        /## 0\.2\.0 - 2026-10-22\n\n### Features\n\n- \*\*web:\*\* add a/
      );
      assert.equal(git('tag', '--list', 'v0.2.0'), '', 'the tool never tags');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('release workflow (REQ-REL-004)', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8');

  it('publishes on version tags only; a manual run is a dry run that builds but never publishes', () => {
    assert.match(workflow, /^on:\n {2}push:\n {4}tags: \['v\*'\]/m);
    assert.match(workflow, /^ {2}workflow_dispatch:/m);
    // A tag push releases that tag; a dry run uses the version in package.json.
    assert.ok(workflow.includes('if [ "$GITHUB_REF_TYPE" = tag ]; then tag="$GITHUB_REF_NAME"'));
    assert.ok(workflow.includes(`else tag="v$(node -p "require('./package.json').version")"; fi`));
    assert.doesNotMatch(workflow, /^ {2}pull_request:/m);
    const publish = workflow.slice(workflow.indexOf('- name: Publish'));
    assert.match(publish, /^ {8}if: github\.event_name == 'push'$/m);
    assert.ok(
      publish.indexOf("if: github.event_name == 'push'") < publish.indexOf('gh release create')
    );
  });

  it('checks the tag, tests, builds, and publishes the changelog section with both artifacts', () => {
    for (const step of [
      'node tooling/release/release.mjs check --tag "$TAG"',
      'cargo test --workspace',
      'pnpm run test:ts',
      'pnpm --filter web build',
      ':app:assembleRelease',
      'node tooling/release/release.mjs notes "$TAG"',
      'gh release create "$TAG"',
    ]) {
      assert.ok(workflow.includes(step), step);
    }
  });
});
