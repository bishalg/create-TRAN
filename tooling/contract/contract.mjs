#!/usr/bin/env node
/**
 * Within an API version, changes are additive (spec 028 REQ-VER-002, ADR-0047). Compares the
 * contract snapshots in the working tree (`fixtures/contract/<version>/`, written by
 * `apps/api/tests/contract_test.rs`) with the same files at the last release tag, and fails on a
 * removed route, a removed or renamed response field, a changed type, a new required request
 * field, or a removed request field. A deliberate break goes under a new API version
 * (`/api/v2`), never into an updated snapshot. Plain Node, no dependencies.
 *
 *   pnpm contract:check [--base <git ref>]   compare with <ref> (default: the last v* tag)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const CONTRACT_DIR = 'fixtures/contract';
export const FILES = ['routes.json', 'requests.json', 'responses.json'];

/** The JSON type of `value`, as the problems name it. */
export function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** Every field of `value` by dotted path (`user.role`, `components[].name`) → its types. */
export function shapeOf(value, path = '', into = new Map()) {
  const add = (p, type) => into.set(p, new Set([...(into.get(p) ?? []), type]));
  if (path) add(path, typeOf(value));
  if (Array.isArray(value)) for (const item of value) shapeOf(item, `${path}[]`, into);
  else if (value !== null && typeof value === 'object')
    for (const [key, item] of Object.entries(value)) shapeOf(item, path ? `${path}.${key}` : key, into);
  return into;
}

/** `responses.json` → `"<route> <status>"` → the union of the shapes of its cases. */
export function responseShapes(responses) {
  const shapes = new Map();
  for (const { route, status, body } of responses) {
    const key = `${route} ${status}`;
    shapes.set(key, shapeOf(body, '', shapes.get(key)));
  }
  return shapes;
}

const types = (set) => [...set].sort().join('|');

/** Breaking differences between two `responses.json`: a field gone or retyped, a success gone. */
export function diffResponses(before, after) {
  const [old, now] = [responseShapes(before), responseShapes(after)];
  const problems = [];
  for (const [key, fields] of old) {
    const current = now.get(key);
    if (!current) {
      if (/ 2\d\d$/.test(key)) problems.push(`${key}: no longer answered`);
      continue;
    }
    for (const [path, was] of fields) {
      const is = current.get(path);
      if (!is) problems.push(`${key}: field ${path} was removed or renamed`);
      else if (types(is) !== types(was))
        problems.push(`${key}: field ${path} changed type from ${types(was)} to ${types(is)}`);
    }
  }
  return problems;
}

/** Breaking differences between two `routes.json`: a route gone. */
export function diffRoutes(before, after) {
  return before.filter((route) => !after.includes(route)).map((route) => `${route}: route removed`);
}

/** Breaking differences between two `requests.json`. */
export function diffRequests(before, after) {
  const problems = [];
  for (const [route, fields] of Object.entries(after)) {
    const was = before[route] ?? {};
    for (const [name, spec] of Object.entries(fields)) {
      const old = was[name];
      if (spec.required && !old?.required)
        problems.push(`${route}: request field ${name} is newly required`);
      else if (old && old.type !== spec.type)
        problems.push(`${route}: request field ${name} changed type from ${old.type} to ${spec.type}`);
    }
  }
  for (const [route, fields] of Object.entries(before)) {
    if (!after[route]) continue;
    for (const name of Object.keys(fields))
      if (!(name in after[route])) problems.push(`${route}: request field ${name} was removed`);
  }
  return problems;
}

/** Every problem between two contracts of one version: `{ routes, requests, responses }` each. */
export function diffContract(before, after) {
  return [
    ...diffRoutes(before.routes, after.routes),
    ...diffRequests(before.requests, after.requests),
    ...diffResponses(before.responses, after.responses),
  ];
}

/**
 * Compares every API version the base had with the tree; `read(version, file, side)` returns the
 * parsed file or `undefined`. A version the base had and the tree dropped is itself a problem.
 */
export function compareVersions(versions, read) {
  const problems = [];
  for (const version of versions) {
    const side = (which) =>
      Object.fromEntries(FILES.map((file) => [file.replace('.json', ''), read(version, file, which)]));
    const [before, after] = [side('base'), side('tree')];
    if (Object.values(after).some((v) => v === undefined)) {
      problems.push(`${version}: the contract was removed; a version is retired, not deleted`);
      continue;
    }
    problems.push(...diffContract(before, after).map((p) => `${version} ${p}`));
  }
  return problems;
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** The last release tag, or `undefined` before the first release. */
export function lastTag(root) {
  try {
    return git(root, ['describe', '--tags', '--abbrev=0', '--match', 'v*']).trim();
  } catch {
    return undefined;
  }
}

function main(root, argv) {
  const at = argv.indexOf('--base');
  const base = at === -1 ? lastTag(root) : argv[at + 1];
  const tree = join(root, CONTRACT_DIR);
  const current = readdirSync(tree).filter((name) => /^v\d+$/.test(name));
  if (!base) {
    console.log(
      `contract: no release tag yet, so nothing to compare ${current.join(', ')} against; the first release fixes it`
    );
    return 0;
  }
  let listed;
  try {
    listed = git(root, ['ls-tree', '--name-only', `${base}:${CONTRACT_DIR}`]);
  } catch {
    console.log(`contract: ${base} has no contract snapshots, so nothing to compare against`);
    return 0;
  }
  const versions = listed.split('\n').filter((name) => /^v\d+$/.test(name));
  const read = (version, file, side) => {
    const path = `${CONTRACT_DIR}/${version}/${file}`;
    if (side === 'tree') return existsSync(join(root, path)) ? JSON.parse(readFileSync(join(root, path), 'utf8')) : undefined;
    return JSON.parse(git(root, ['show', `${base}:${path}`]));
  };
  const problems = compareVersions(versions, read);
  for (const problem of problems) console.error(`✗ ${problem}`);
  if (problems.length) {
    console.error(
      `contract: ${problems.length} breaking change(s) since ${base}; make it additive or add a new API version (docs/API_VERSIONING.md)`
    );
    return 1;
  }
  console.log(`contract: ${versions.join(', ') || 'no version'} additive since ${base}`);
  return 0;
}

// realpath: a symlinked path (macOS /var -> /private/var) must still count as running this file.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    process.exitCode = main(process.cwd(), process.argv.slice(2));
  } catch (error) {
    console.error(`contract: ${error.message}`);
    process.exitCode = 1;
  }
}
