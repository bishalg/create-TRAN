#!/usr/bin/env node
/**
 * Release tooling (ADR-0034, spec 017). Plain Node, no dependencies.
 *
 *   pnpm release:check [--tag vX.Y.Z]     every version field agrees with the root package.json
 *   pnpm release <auto|patch|minor|major>  bump every version, prepend the CHANGELOG section; never tags
 *   node tooling/release/release.mjs set <version>     write one version everywhere (create-tran uses it)
 *   node tooling/release/release.mjs notes <version>   print that version's CHANGELOG section (release notes)
 *   node tooling/release/release.mjs lint-commit <file>  the commit-msg hook
 *
 * The root package.json chooses the version. Build numbers are derived from it:
 * major × 1,000,000 + minor × 1,000 + patch, so they always increase.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;

function parseVersion(version) {
  const match = VERSION.exec(version);
  if (!match) throw new Error(`"${version}" is not a version (major.minor.patch)`);
  return match.slice(1).map(Number);
}

export function buildNumber(version) {
  const [major, minor, patch] = parseVersion(version);
  if (minor >= 1000 || patch >= 1000) {
    throw new Error(`${version}: minor and patch must stay below 1000 for the build number`);
  }
  return major * 1_000_000 + minor * 1_000 + patch;
}

/** A field in a file: how to read it and how to write it, by regex on the text. */
const field = (name, pattern, derive) => ({ name, pattern, derive });

/** The `version` of a package.json: the first top-level key, never a dependency's. */
const PACKAGE_VERSION = field('version', /^( {2}"version":\s*")([^"]*)(")/m, (v) => v);

/** `[workspace.package] version`: the section is found first, so dependency versions are untouched. */
const CARGO_SECTION = /(\[workspace\.package\][^[]*?^version\s*=\s*")([^"]*)(")/ms;

const FIELDS_BY_FILE = [
  { match: (path) => path.endsWith('package.json'), fields: [PACKAGE_VERSION] },
  {
    match: (path) => path === 'Cargo.toml',
    fields: [field('workspace.package.version', CARGO_SECTION, (v) => v)],
  },
  {
    // Workspace crates are the lock entries with no `source`; left stale, the next build rewrites the lock.
    match: (path) => path === 'Cargo.lock',
    fields: [
      field(
        'workspace crate version',
        /(\[\[package\]\]\nname = "[^"]+"\nversion = ")([^"]*)("\n(?!source = ))/g,
        (v) => v
      ),
    ],
  },
  {
    match: (path) => path.endsWith('project.yml'),
    fields: [
      field('MARKETING_VERSION', /(MARKETING_VERSION:\s*')([^']*)(')/, (v) => v),
      field('CURRENT_PROJECT_VERSION', /(CURRENT_PROJECT_VERSION:\s*')([^']*)(')/, (v) =>
        String(buildNumber(v))
      ),
    ],
  },
  {
    // Generated from project.yml by XcodeGen but committed; Debug and Release each carry both.
    match: (path) => path.endsWith('.pbxproj'),
    fields: [
      field('MARKETING_VERSION', /(MARKETING_VERSION = )([^;]*)(;)/g, (v) => v),
      field('CURRENT_PROJECT_VERSION', /(CURRENT_PROJECT_VERSION = )([^;]*)(;)/g, (v) =>
        String(buildNumber(v))
      ),
    ],
  },
  {
    match: (path) => path.endsWith('build.gradle.kts'),
    fields: [
      field('versionName', /(versionName\s*=\s*")([^"]*)(")/, (v) => v),
      field('versionCode', /(versionCode\s*=\s*)(\d+)()/, (v) => String(buildNumber(v))),
    ],
  },
];

/** Every match of a global pattern, or the first of a plain one. */
const matches = (pattern, text) =>
  pattern.global ? [...text.matchAll(pattern)] : [pattern.exec(text)].filter(Boolean);

const fieldsOf = (path) => FIELDS_BY_FILE.find((kind) => kind.match(path))?.fields ?? [];

/** Every version field in `files` (a Map of path → text), in file order. */
export function readVersions(files) {
  const found = [];
  for (const [file, text] of files) {
    for (const { name, pattern } of fieldsOf(file)) {
      const match = matches(pattern, text)[0];
      if (match) found.push({ file, field: name, value: match[2] });
    }
  }
  return found;
}

export function checkVersions(files, { tag } = {}) {
  const root = files.get('package.json');
  const version = root && PACKAGE_VERSION.pattern.exec(root)?.[2];
  if (!version) return ['package.json: no version'];
  const problems = [];
  for (const [file, text] of files) {
    for (const { name, pattern, derive } of fieldsOf(file)) {
      const found = matches(pattern, text);
      const expected = derive(version);
      if (!found.length) problems.push(`${file}: no ${name}`);
      for (const match of found) {
        if (match[2] !== expected)
          problems.push(`${file}: ${name} is ${match[2]}, expected ${expected}`);
      }
    }
  }
  if (tag !== undefined && tag !== `v${version}`) {
    problems.push(`tag ${tag} does not match version ${version}`);
  }
  return problems;
}

/** `files` with every version field set to `version` (a new Map; the input is not changed). */
export function setVersion(files, version) {
  buildNumber(version);
  const next = new Map();
  for (const [file, text] of files) {
    let updated = text;
    for (const { pattern, derive } of fieldsOf(file)) {
      updated = updated.replace(
        pattern,
        (_, before, _old, after) => before + derive(version) + after
      );
    }
    next.set(file, updated);
  }
  return next;
}

/** Package folders from `pnpm-workspace.yaml` (`dir/*` or `dir`), then the native and Rust files. */
export function versionFiles(root) {
  const paths = ['package.json'];
  const workspace = join(root, 'pnpm-workspace.yaml');
  const globs = existsSync(workspace)
    ? [...readFileSync(workspace, 'utf8').matchAll(/^\s+-\s+'?([^'\s]+)'?\s*$/gm)].map((m) => m[1])
    : [];
  for (const glob of globs) {
    const parent = join(root, glob.slice(0, -2));
    const dirs = glob.endsWith('/*')
      ? (existsSync(parent) ? readdirSync(parent, { withFileTypes: true }) : [])
          .filter((entry) => entry.isDirectory())
          .map((entry) => `${glob.slice(0, -2)}/${entry.name}`)
      : [glob];
    for (const dir of dirs) {
      if (existsSync(join(root, dir, 'package.json'))) paths.push(`${dir}/package.json`);
    }
  }
  for (const path of [
    'Cargo.toml',
    'Cargo.lock',
    'apps/ios/project.yml',
    'apps/android/app/build.gradle.kts',
  ]) {
    if (existsSync(join(root, path))) paths.push(path);
  }
  // The Xcode project is named after the app, which create-tran renames.
  const ios = join(root, 'apps/ios');
  for (const entry of existsSync(ios) ? readdirSync(ios) : []) {
    if (entry.endsWith('.xcodeproj') && existsSync(join(ios, entry, 'project.pbxproj'))) {
      paths.push(`apps/ios/${entry}/project.pbxproj`);
    }
  }
  return paths;
}

const TYPES = [
  'feat',
  'fix',
  'perf',
  'refactor',
  'docs',
  'test',
  'build',
  'ci',
  'chore',
  'style',
  'revert',
];
const HEADER = new RegExp(`^(${TYPES.join('|')})(?:\\(([\\w./-]+)\\))?(!)?: (\\S.*)$`);

export function parseCommit(header, body = '') {
  const match = HEADER.exec(header);
  if (!match) return undefined;
  const [, type, scope, bang, subject] = match;
  return { type, scope, breaking: Boolean(bang) || /^BREAKING[ -]CHANGE:/m.test(body), subject };
}

const EXEMPT = /^(Merge |Revert "|fixup! |squash! )/;

/** Why a commit message is rejected, or undefined. Lines git strips (`#`) are ignored. */
export function lintCommitMessage(message) {
  const header = message
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('\n')
    .trim()
    .split('\n')[0];
  if (!header) return 'empty commit message';
  if (EXEMPT.test(header) || parseCommit(header)) return undefined;
  return `"${header}" is not a Conventional Commit header: type(scope)!: subject, type one of ${TYPES.join(', ')}`;
}

export function nextVersion(current, commits, level) {
  const [major, minor, patch] = parseVersion(current);
  let bump = level;
  if (level === 'auto') {
    if (commits.some((c) => c.breaking)) bump = major === 0 ? 'minor' : 'major';
    else if (commits.some((c) => c.type === 'feat')) bump = 'minor';
    else bump = 'patch';
  }
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  if (bump === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`level must be auto, patch, minor or major, not "${level}"`);
}

const GROUPS = [
  ['Breaking changes', (c) => c.breaking],
  ['Features', (c) => c.type === 'feat'],
  ['Fixes', (c) => c.type === 'fix'],
  ['Performance', (c) => c.type === 'perf'],
  ['Other changes', () => true],
];

/** One CHANGELOG section. Each commit appears once, in the first group that takes it. */
export function changelogSection(version, date, commits) {
  const lines = [`## ${version} - ${date}`, ''];
  let left = commits.filter(
    (c) => !/^Merge /.test(c.header) && !/^chore\(release\)/.test(c.header)
  );
  for (const [title, takes] of GROUPS) {
    const taken = left.filter((c) => takes(c));
    left = left.filter((c) => !takes(c));
    if (!taken.length) continue;
    lines.push(`### ${title}`, '');
    for (const c of taken) {
      const text =
        title === 'Other changes' || !c.type
          ? c.header
          : `${c.scope ? `**${c.scope}:** ` : ''}${c.subject}`;
      lines.push(`- ${text} (${c.hash})`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** `section` inserted above the newest existing section, below the title and intro. */
export function prependChangelog(existing, section) {
  const at = existing.search(/^## /m);
  if (at < 0) return `${existing.trimEnd()}\n\n${section}`;
  return `${existing.slice(0, at)}${section}\n${existing.slice(at)}`;
}

export function notesFor(changelog, version) {
  const v = version.replace(/^v/, '');
  const start = changelog.search(new RegExp(`^## ${v.replace(/\./g, '\\.')}( |$)`, 'm'));
  if (start < 0) throw new Error(`CHANGELOG.md has no section for ${v}`);
  const rest = changelog.slice(start);
  const end = rest.slice(1).search(/^## /m);
  const section = end < 0 ? rest : rest.slice(0, end + 1);
  return section.split('\n').slice(1).join('\n').trim();
}

export const EMPTY_CHANGELOG =
  '# Changelog\n\nAll notable changes, newest first. Written by `pnpm release` from Conventional Commits.\n';

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function lastTag(root) {
  try {
    return git(root, ['describe', '--tags', '--abbrev=0', '--match', 'v*']).trim();
  } catch {
    return undefined;
  }
}

function commitsSince(root, tag) {
  const out = git(root, [
    'log',
    '--no-merges',
    '--format=%h%x1f%s%x1f%b%x1e',
    ...(tag ? [`${tag}..HEAD`] : []),
  ]);
  return out
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash, header, body = ''] = record.split('\x1f');
      return { hash, header, ...parseCommit(header, body) };
    });
}

const readFiles = (root) =>
  new Map(versionFiles(root).map((path) => [path, readFileSync(join(root, path), 'utf8')]));

function writeFiles(root, files) {
  for (const [path, text] of files) writeFileSync(join(root, path), text);
}

function main(root, argv) {
  const [command, arg] = argv;
  const flag = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  switch (command) {
    case 'check': {
      const problems = checkVersions(readFiles(root), { tag: flag('--tag') });
      for (const problem of problems) console.error(`✗ ${problem}`);
      if (problems.length) return 1;
      console.log('release: every version agrees');
      return 0;
    }
    case 'lint-commit': {
      const problem = lintCommitMessage(readFileSync(arg, 'utf8'));
      if (!problem) return 0;
      console.error(
        `✗ ${problem}\n  e.g. "feat(web): show a loading state" or "fix(api)!: reject ages over 150"`
      );
      return 1;
    }
    case 'set': {
      writeFiles(root, setVersion(readFiles(root), arg));
      console.log(`release: every version set to ${arg}`);
      return 0;
    }
    case 'notes': {
      console.log(notesFor(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), arg));
      return 0;
    }
    case 'bump': {
      if (git(root, ['status', '--porcelain']).trim()) {
        throw new Error('the working tree has uncommitted changes; commit or stash them first');
      }
      const tag = lastTag(root);
      const commits = commitsSince(root, tag);
      if (!commits.length)
        throw new Error(`no commits since ${tag ?? 'the start'}; nothing to release`);
      const files = readFiles(root);
      const current = PACKAGE_VERSION.pattern.exec(files.get('package.json'))[2];
      const version = nextVersion(current, commits, arg);
      writeFiles(root, setVersion(files, version));
      const changelogPath = join(root, 'CHANGELOG.md');
      const existing = existsSync(changelogPath)
        ? readFileSync(changelogPath, 'utf8')
        : EMPTY_CHANGELOG;
      const date = flag('--date') ?? new Date().toISOString().slice(0, 10);
      writeFileSync(
        changelogPath,
        prependChangelog(existing, changelogSection(version, date, commits))
      );
      console.log(
        [
          `release: ${current} -> ${version} (${commits.length} commits since ${tag ?? 'the start'})`,
          'Read the diff, then:',
          `  git commit -am "chore(release): v${version}"`,
          `  git tag v${version}`,
          `  git push origin HEAD v${version}`,
        ].join('\n')
      );
      return 0;
    }
    default:
      console.error(
        'usage: release.mjs check [--tag vX.Y.Z] | bump <auto|patch|minor|major> [--date YYYY-MM-DD] | set <version> | notes <version> | lint-commit <file>'
      );
      return 2;
  }
}

// realpath: a symlinked path (macOS /var -> /private/var) must still count as running this file.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    process.exitCode = main(process.cwd(), process.argv.slice(2));
  } catch (error) {
    console.error(`release: ${error.message}`);
    process.exitCode = 1;
  }
}
