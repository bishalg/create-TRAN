#!/usr/bin/env node
/**
 * `pnpm supply:check` (ADR-0033, spec 016): the supply-chain settings that are easy to lose in a
 * refactor or a fork, checked in CI next to the audits themselves.
 *
 * - every `uses:` in every workflow is pinned to a 40-character commit SHA with a version comment
 * - `.github/dependabot.yml` covers every package ecosystem the repo actually has
 * - every pnpm override names the vulnerable range as its key, so it expires on its own
 * - every Rust advisory ignored in `.cargo/audit.toml` says why
 * - `SECURITY.md` says how to report and what CI enforces
 */
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const USES = /^\s*-?\s*uses:\s*([^\s#]+)(\s*#.*)?$/;

/** Unpinned or uncommented `uses:` lines of one workflow. */
export function unpinnedActions(yaml) {
  const problems = [];
  yaml.split('\n').forEach((line, index) => {
    const match = USES.exec(line);
    if (!match) return;
    const [, ref, comment] = match;
    if (ref.startsWith('./') || ref.startsWith('docker://')) return;
    const at = ref.lastIndexOf('@');
    const version = at < 0 ? '' : ref.slice(at + 1);
    if (!/^[0-9a-f]{40}$/.test(version))
      problems.push(`line ${index + 1}: ${ref} is not pinned to a commit SHA`);
    else if (!comment || !/#\s*\S/.test(comment))
      problems.push(`line ${index + 1}: ${ref} has no version comment`);
  });
  return problems;
}

/** The Dependabot ecosystems a repo needs, from the files it has. */
export function requiredEcosystems(exists) {
  const needed = [];
  if (exists('package.json')) needed.push('npm');
  if (exists('Cargo.toml')) needed.push('cargo');
  if (exists('.github/workflows')) needed.push('github-actions');
  if (exists('apps/android/build.gradle.kts')) needed.push('gradle');
  if (exists('Package.swift')) needed.push('swift');
  return needed;
}

/** Ecosystems named in a dependabot.yml; a tiny parser, the file has one shape. */
export function dependabotEcosystems(yaml) {
  return [...yaml.matchAll(/^\s*-\s*package-ecosystem:\s*([\w-]+)/gm)].map((m) => m[1]);
}

/** Override keys without a version range (`undici` instead of `undici@<7.29.1`). */
export function openEndedOverrides(workspaceYaml) {
  const section = /^overrides:\n((?:[ \t]+.*\n?)*)/m.exec(workspaceYaml);
  if (!section) return [];
  return [...section[1].matchAll(/^\s+'?([^':\n]+)'?\s*:/gm)]
    .map((m) => m[1].trim())
    .filter((key) => !/@[<>=~^]/.test(key) && !/@[^@]*\s/.test(key));
}

/** Advisory ids in `.cargo/audit.toml`'s `ignore` list whose line has no comment directly above it. */
export function unexplainedIgnores(toml) {
  const lines = toml.split('\n');
  const start = lines.findIndex((line) => /^\s*ignore\s*=\s*\[/.test(line));
  if (start < 0) return [];
  const unexplained = [];
  for (let i = start; i < lines.length; i++) {
    const ids = [...lines[i].matchAll(/"(RUSTSEC-[\d-]+)"/g)].map((m) => m[1]);
    if (ids.length && !/^\s*#/.test(lines[i - 1] ?? '')) unexplained.push(...ids);
    if (lines[i].includes(']')) break;
  }
  return unexplained;
}

const SECURITY_SECTIONS = ['## Reporting a vulnerability', '## Supported versions'];

export function securityProblems(markdown) {
  return SECURITY_SECTIONS.filter((section) => !markdown.includes(section)).map(
    (section) => `SECURITY.md: missing section "${section}"`
  );
}

export function checkAll(root) {
  const read = (path) => readFileSync(join(root, path), 'utf8');
  const exists = (path) => existsSync(join(root, path));
  const errors = [];
  const workflows = join(root, '.github/workflows');
  for (const file of existsSync(workflows)
    ? readdirSync(workflows).filter((f) => /\.ya?ml$/.test(f))
    : []) {
    errors.push(
      ...unpinnedActions(read(`.github/workflows/${file}`)).map(
        (p) => `.github/workflows/${file}: ${p}`
      )
    );
  }
  if (!exists('.github/dependabot.yml')) errors.push('.github/dependabot.yml: missing');
  else {
    const have = new Set(dependabotEcosystems(read('.github/dependabot.yml')));
    for (const eco of requiredEcosystems(exists)) {
      if (!have.has(eco)) errors.push(`.github/dependabot.yml: no "${eco}" ecosystem`);
    }
  }
  if (exists('pnpm-workspace.yaml')) {
    errors.push(
      ...openEndedOverrides(read('pnpm-workspace.yaml')).map(
        (key) => `pnpm-workspace.yaml: override "${key}" has no vulnerable range (use name@<fixed)`
      )
    );
  }
  if (exists('.cargo/audit.toml')) {
    errors.push(
      ...unexplainedIgnores(read('.cargo/audit.toml')).map(
        (id) => `.cargo/audit.toml: ${id} is ignored without a reason in a comment above it`
      )
    );
  }
  errors.push(
    ...(exists('SECURITY.md') ? securityProblems(read('SECURITY.md')) : ['SECURITY.md: missing'])
  );
  return errors;
}

// realpath: a symlinked path (macOS /var -> /private/var) must still count as running this file.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const errors = checkAll(process.cwd());
  for (const error of errors) console.error(`✗ ${error}`);
  if (errors.length) process.exit(1);
  console.log(
    'supply-chain: actions pinned, Dependabot complete, overrides ranged, SECURITY.md present'
  );
}
