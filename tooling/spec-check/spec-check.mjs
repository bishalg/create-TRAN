#!/usr/bin/env node
/**
 * Keeps specs honest: every `verified` requirement in docs/specs must be cited by at least one
 * test or Gherkin scenario, and every requirement id cited by a test must exist in a spec.
 *
 * Requirement headings look like:  ### REQ-API-003 [verified] POST eligibility
 * Status is `verified` (default) or `planned` (spec written first, tests not yet).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const ID = /REQ-[A-Z0-9]+-\d{3}/g;
const HEADING = /^###\s+(REQ-[A-Z0-9]+-\d{3})(?:\s+\[(verified|planned)\])?\s+(.+?)\s*$/;

export function parseRequirements(markdown, file) {
  return markdown.split('\n').flatMap((line) => {
    const match = HEADING.exec(line);
    return match ? [{ id: match[1], status: match[2] ?? 'verified', title: match[3], file }] : [];
  });
}

export function checkSpecs(requirements, sources) {
  const defined = new Set(requirements.map((r) => r.id));
  const cited = new Map();
  const unknown = [];

  for (const { file, text } of sources) {
    for (const id of new Set(text.match(ID) ?? [])) {
      if (!cited.has(id)) cited.set(id, file);
      if (!defined.has(id)) unknown.push({ id, file });
    }
  }

  const uncovered = requirements.filter((r) => r.status === 'verified' && !cited.has(r.id));
  return { uncovered, unknown, ok: uncovered.length === 0 && unknown.length === 0 };
}

const SKIP_DIRS = new Set([
  'node_modules',
  'target',
  'dist',
  'build',
  '.git',
  '.gradle',
  'coverage',
  '.features-gen',
  'test-results',
  'playwright-report',
  '.output',
  'DerivedData',
]);
const SOURCE_FILE =
  /\.(test|spec)\.[cm]?[jt]sx?$|\.feature$|_test\.rs$|Tests?\.(swift|kt)$|\/tests\/.+\.rs$|^\/e2e\/maestro\/flows\/.+\.ya?ml$/;

/** Files whose `REQ-…` ids count as citations: tests in every language, Gherkin, Maestro flows, Rust `src`. */
export function isCitingSource(path) {
  if (path.startsWith('tooling/spec-check/')) return false;
  return SOURCE_FILE.test(`/${path}`) || /^(crates|apps)\/.+\/src\/.+\.rs$/.test(path);
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

function main(root) {
  const specDir = join(root, 'docs', 'specs');
  const requirements = readdirSync(specDir)
    .filter((f) => /^\d{3}-.+\.md$/.test(f))
    .flatMap((f) => parseRequirements(readFileSync(join(specDir, f), 'utf8'), `docs/specs/${f}`));

  const sources = walk(root)
    .map((p) => relative(root, p))
    .filter(isCitingSource)
    .map((file) => ({ file, text: readFileSync(join(root, file), 'utf8') }));

  const { uncovered, unknown, ok } = checkSpecs(requirements, sources);
  const verified = requirements.filter((r) => r.status === 'verified').length;
  const planned = requirements.length - verified;

  console.log(
    `spec-check: ${requirements.length} requirements (${verified} verified, ${planned} planned)`
  );
  for (const r of uncovered)
    console.error(`  ✗ ${r.id} is verified but no test cites it (${r.file}: ${r.title})`);
  for (const u of unknown)
    console.error(`  ✗ ${u.id} is cited in ${u.file} but no spec defines it`);
  if (!ok) process.exit(1);
  console.log('spec-check: ok');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main(process.cwd());
