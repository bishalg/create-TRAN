#!/usr/bin/env node
/**
 * A migration never breaks the version that is still running (spec 030 REQ-DB-005, ADR-0049), and
 * the database holds nothing undocumented (REQ-DB-010). Fails when a file in `apps/api/migrations/`
 * drops or renames a table or column, adds a NOT NULL column without a default, or tightens a
 * constraint on an existing table (a unique index), unless the file carries
 * `-- contract: <reason and the release that stopped using it>`; when a migration present at the
 * last release tag was changed or removed; and when `apps/api/schema.sql` has a column that the
 * "What is stored" table of `docs/PERSISTENCE.md` does not list (or the table lists one it lacks).
 * Plain Node, no dependencies.
 *
 *   pnpm migrations:check [--base <git ref>]   compare with <ref> (default: the last v* tag)
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MIGRATIONS_DIR = 'apps/api/migrations';
export const SCHEMA = 'apps/api/schema.sql';
export const DOC = 'docs/PERSISTENCE.md';
const MARKER = /^--\s*contract:(.*)$/im;
const RELEASE = /\bv?\d+\.\d+(?:\.\d+)?\b/;

/** `sql` without `--` and `/* *\/` comments; quoted text is kept as it is. */
export function stripComments(sql) {
  let out = '';
  for (let i = 0; i < sql.length; i++) {
    const [c, next] = [sql[i], sql[i + 1]];
    if (c === "'" || c === '"') {
      const end = sql.indexOf(c, i + 1);
      const stop = end === -1 ? sql.length : end + 1;
      out += sql.slice(i, stop);
      i = stop - 1;
    } else if (c === '-' && next === '-') {
      const end = sql.indexOf('\n', i);
      i = (end === -1 ? sql.length : end) - 1;
    } else if (c === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = (end === -1 ? sql.length : end + 2) - 1;
    } else out += c;
  }
  return out;
}

/** The statements of `sql`, comments removed and whitespace collapsed. */
export function statements(sql) {
  return stripComments(sql)
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

const IDENT = String.raw`["\`\[]?(\w+)["\`\]]?`;
const DETECTORS = [
  [new RegExp(String.raw`^DROP (?:TABLE|VIEW) (?:IF EXISTS )?${IDENT}`, 'i'), (m) => `drops table ${m[1]}`],
  [
    new RegExp(String.raw`^ALTER TABLE ${IDENT} DROP (?:COLUMN )?${IDENT}`, 'i'),
    (m) => `drops column ${m[1]}.${m[2]}`,
  ],
  [new RegExp(String.raw`^ALTER TABLE ${IDENT} RENAME TO ${IDENT}`, 'i'), (m) => `renames table ${m[1]} to ${m[2]}`],
  [
    new RegExp(String.raw`^ALTER TABLE ${IDENT} RENAME (?:COLUMN )?${IDENT} TO ${IDENT}`, 'i'),
    (m) => `renames column ${m[1]}.${m[2]} to ${m[3]}`,
  ],
  [
    new RegExp(String.raw`^ALTER TABLE ${IDENT} ADD (?:COLUMN )?${IDENT} (.*)$`, 'i'),
    (m) =>
      /\bNOT NULL\b/i.test(m[3]) && !/\bDEFAULT\b/i.test(m[3])
        ? `adds NOT NULL column ${m[1]}.${m[2]} without a default`
        : undefined,
  ],
];

/** What in one migration breaks the previous release's code; tables it creates itself are new. */
export function breakingChanges(sql) {
  const all = statements(sql);
  const created = new Set(
    all
      .map((s) => s.match(new RegExp(String.raw`^CREATE TABLE (?:IF NOT EXISTS )?${IDENT}`, 'i'))?.[1])
      .filter(Boolean)
      .map((name) => name.toLowerCase())
  );
  const problems = [];
  for (const statement of all) {
    for (const [pattern, describe] of DETECTORS) {
      const match = statement.match(pattern);
      const problem = match && describe(match);
      if (problem) problems.push(problem);
    }
    const unique = statement.match(
      new RegExp(String.raw`^CREATE UNIQUE INDEX (?:IF NOT EXISTS )?${IDENT} ON ${IDENT}`, 'i')
    );
    if (unique && !created.has(unique[2].toLowerCase()))
      problems.push(`tightens a constraint: unique index ${unique[1]} on existing table ${unique[2]}`);
  }
  return problems;
}

/** The problems of one migration file, given its name and text. */
export function checkMigration(name, sql) {
  const problems = breakingChanges(sql);
  if (!problems.length) return [];
  const reason = sql.match(MARKER)?.[1].trim();
  if (reason && RELEASE.test(reason)) return [];
  const fix = reason
    ? '`-- contract:` must name the release that stopped using it (for example v1.4.0)'
    : 'expand first; contract later with `-- contract: <reason and the release that stopped using it>`';
  return problems.map((problem) => `${name}: ${problem}; ${fix}`);
}

/** Released migrations (`{ name: text }` at the base) changed or removed in the tree. */
export function compareReleased(base, tree) {
  const problems = [];
  for (const [name, text] of Object.entries(base)) {
    if (!(name in tree)) problems.push(`${name}: released migration was removed; fix forward instead`);
    else if (tree[name] !== text) problems.push(`${name}: released migration was changed; fix forward instead`);
  }
  return problems;
}

/** The items of a parenthesised list, split on top-level commas. */
function items(body) {
  const parts = [];
  let [depth, start] = [0, 0];
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '(') depth++;
    else if (body[i] === ')') depth--;
    else if (body[i] === ',' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  return [...parts, body.slice(start)].map((part) => part.trim());
}

const CONSTRAINT = /^(PRIMARY|UNIQUE|CHECK|FOREIGN|CONSTRAINT)\b/i;

/** `{ table: [columns] }` of every CREATE TABLE in `sql`. */
export function schemaColumns(sql) {
  const tables = {};
  for (const statement of statements(sql)) {
    const head = statement.match(new RegExp(String.raw`^CREATE TABLE (?:IF NOT EXISTS )?${IDENT} \(`, 'i'));
    if (!head) continue;
    const body = statement.slice(head[0].length, statement.lastIndexOf(')'));
    tables[head[1]] = items(body)
      .filter((item) => !CONSTRAINT.test(item))
      .map((item) => item.match(new RegExp(`^${IDENT}`))[1]);
  }
  return tables;
}

/** The rows of the "What is stored" table: `{ table, column, purpose, kept }`. */
export function documentedColumns(markdown) {
  const section = markdown.split(/^## /m).find((part) => part.startsWith('What is stored'));
  if (!section) return [];
  return section
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .map((line) =>
      line
        .split('|')
        .slice(1, -1)
        .map((cell) => cell.trim().replace(/`/g, ''))
    )
    .filter(([table]) => table && table !== 'Table' && !/^:?-+:?$/.test(table))
    .map(([table, column, purpose, kept]) => ({ table, column, purpose, kept }));
}

/** Both directions, and every row says why the column exists and how long it is kept. */
export function compareDocs(tables, rows) {
  const problems = [];
  const listed = new Set(rows.map((row) => `${row.table}.${row.column}`));
  const inSchema = new Set(Object.entries(tables).flatMap(([t, columns]) => columns.map((c) => `${t}.${c}`)));
  for (const column of inSchema)
    if (!listed.has(column)) problems.push(`${column} is in ${SCHEMA} but not listed in "What is stored" (${DOC})`);
  for (const row of rows) {
    const column = `${row.table}.${row.column}`;
    if (!inSchema.has(column)) problems.push(`${column} is listed in ${DOC} but not in ${SCHEMA}`);
    else if (!row.purpose || !row.kept) problems.push(`${column}: give its purpose and how long it is kept (${DOC})`);
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

/** `{ name: text }` of the migrations at `base`, or `undefined` when it has none. */
function releasedMigrations(root, base) {
  let listed;
  try {
    listed = git(root, ['ls-tree', '--name-only', `${base}:${MIGRATIONS_DIR}`]);
  } catch {
    return undefined;
  }
  const names = listed.split('\n').filter((name) => name.endsWith('.sql'));
  return Object.fromEntries(names.map((name) => [name, git(root, ['show', `${base}:${MIGRATIONS_DIR}/${name}`])]));
}

function main(root, argv) {
  const read = (path) => readFileSync(join(root, path), 'utf8');
  const names = readdirSync(join(root, MIGRATIONS_DIR)).filter((name) => name.endsWith('.sql'));
  const tree = Object.fromEntries(names.map((name) => [name, read(`${MIGRATIONS_DIR}/${name}`)]));
  const problems = Object.entries(tree).flatMap(([name, sql]) => checkMigration(name, sql));
  problems.push(...compareDocs(schemaColumns(read(SCHEMA)), documentedColumns(read(DOC))));

  const at = argv.indexOf('--base');
  const base = at === -1 ? lastTag(root) : argv[at + 1];
  const released = base && releasedMigrations(root, base);
  if (!base) console.log('migrations: no release tag yet, so no migration is released and any may still change');
  else if (!released) console.log(`migrations: ${base} has no migrations, so none is released yet`);
  else problems.push(...compareReleased(released, tree));

  for (const problem of problems) console.error(`✗ ${problem}`);
  if (problems.length) {
    console.error(`migrations: ${problems.length} problem(s); see docs/PERSISTENCE.md`);
    return 1;
  }
  console.log(`migrations: ${names.length} migration(s) expand-only, every stored column documented`);
  return 0;
}

// realpath: a symlinked path (macOS /var -> /private/var) must still count as running this file.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    process.exitCode = main(process.cwd(), process.argv.slice(2));
  } catch (error) {
    console.error(`migrations: ${error.message}`);
    process.exitCode = 1;
  }
}
